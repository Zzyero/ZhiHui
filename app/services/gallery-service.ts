import path from "node:path";
import fs from "node:fs/promises";
import crypto from "node:crypto";
import { parseComfyPngMetadata } from "@/app/helpers/png-metadata";

export interface IGalleryItem {
    id: string;
    sectionName: string;
    workflowTitle: string;
    workflowId: string;
    createdAt: number;
    /** 相对画廊目录的图片路径，如 "images/<id>.png" */
    imagePath: string;
    /** 从 PNG 解析出的 ComfyUI prompt（nodeId -> { class_type, inputs }） */
    prompt: Record<string, any>;
}

const DEFAULT_GALLERY_DIR = path.join(process.cwd(), "gallery");

/**
 * 画廊存储：磁盘 manifest（gallery/gallery.json）+ 图片目录（gallery/images/）。
 * 单进程 next start 自托管场景下用内存缓存 + 写盘，重启后数据仍在。
 */
class GalleryService {
    private dir: string;
    private manifestPath: string;
    private cache: IGalleryItem[] | undefined;

    constructor() {
        this.dir = process.env.GALLERY_DIR || DEFAULT_GALLERY_DIR;
        this.manifestPath = path.join(this.dir, "gallery.json");
    }

    private async load(): Promise<IGalleryItem[]> {
        if (this.cache) return this.cache;
        try {
            const raw = await fs.readFile(this.manifestPath, "utf8");
            const parsed = JSON.parse(raw);
            this.cache = Array.isArray(parsed) ? parsed : [];
        } catch {
            this.cache = [];
        }
        return this.cache;
    }

    private async persist(items: IGalleryItem[]): Promise<void> {
        this.cache = items;
        await fs.mkdir(this.dir, { recursive: true });
        await fs.writeFile(this.manifestPath, JSON.stringify(items, null, 2), "utf8");
    }

    /** 列表（按时间倒序，最新在前） */
    async list(): Promise<IGalleryItem[]> {
        const items = await this.load();
        return [...items].sort((a, b) => b.createdAt - a.createdAt);
    }

    async getItem(id: string): Promise<IGalleryItem | undefined> {
        const items = await this.load();
        return items.find((item) => item.id === id);
    }

    async add(params: {
        sectionName: string;
        workflowTitle: string;
        workflowId: string;
        image: File;
    }): Promise<IGalleryItem> {
        const items = await this.load();
        const id = crypto.randomUUID();
        const ext = path.extname(params.image.name).toLowerCase() || ".png";
        const imagePath = `images/${id}${ext}`;

        const buf = Buffer.from(await params.image.arrayBuffer());
        const absImagePath = path.join(this.dir, imagePath);
        await fs.mkdir(path.dirname(absImagePath), { recursive: true });
        await fs.writeFile(absImagePath, buf);

        const metadata = parseComfyPngMetadata(buf);

        const item: IGalleryItem = {
            id,
            sectionName: params.sectionName,
            workflowTitle: params.workflowTitle,
            workflowId: params.workflowId,
            createdAt: Date.now(),
            imagePath,
            prompt: metadata.prompt ?? {},
        };
        items.push(item);
        await this.persist(items);
        return item;
    }

    getImageAbsolutePath(item: IGalleryItem): string {
        return path.join(this.dir, item.imagePath);
    }

    async delete(id: string): Promise<boolean> {
        const items = await this.load();
        const index = items.findIndex((item) => item.id === id);
        if (index === -1) return false;
        const [removed] = items.splice(index, 1);
        await this.persist(items);
        try {
            await fs.unlink(this.getImageAbsolutePath(removed));
        } catch {
            // 图片文件不存在时忽略
        }
        return true;
    }
}

export const galleryService = new GalleryService();
