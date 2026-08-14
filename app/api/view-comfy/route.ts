import { type NextRequest, NextResponse } from 'next/server';
import path from 'node:path';
import fs from 'node:fs/promises';
import { viewComfyFileName, missingViewComfyFileError } from '@/app/constants';

const VIEW_COMFY_PATH = path.join(process.cwd(), viewComfyFileName);

async function fileExists(filePath: string): Promise<boolean> {
    try {
        await fs.access(filePath);
        return true;
    } catch {
        return false;
    }
}

interface IViewComfySection {
    name: string;
    workflows: string[];
}

export async function GET() {
    try {
        if (!await fileExists(VIEW_COMFY_PATH)) {
            return NextResponse.json({ error: missingViewComfyFileError }, { status: 404 });
        }
        const content = await fs.readFile(VIEW_COMFY_PATH, 'utf8');
        return NextResponse.json(JSON.parse(content));
    } catch (err) {
        console.error('GET /api/view-comfy failed', err);
        return NextResponse.json({ error: String(err) }, { status: 500 });
    }
}

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const action: string | undefined = body?.action;

        if (!await fileExists(VIEW_COMFY_PATH)) {
            return NextResponse.json({ error: missingViewComfyFileError }, { status: 404 });
        }
        const content = await fs.readFile(VIEW_COMFY_PATH, 'utf8');
        const data = JSON.parse(content);

        if (action === 'update-sections') {
            const sections: IViewComfySection[] = body.sections;
            if (!Array.isArray(sections)) {
                return NextResponse.json({ error: 'sections must be an array' }, { status: 400 });
            }
            // 清洗：每个 section.name 必须存在；workflows 只保留当前真实存在的标题
            const existingTitles = new Set<string>(
                (data.workflows || []).map((w: any) => w?.viewComfyJSON?.title).filter(Boolean)
            );
            data.sections = sections.map((s) => ({
                name: s.name,
                workflows: (s.workflows || []).filter((t: string) => existingTitles.has(t)),
            }));
        } else if (action === 'save') {
            const payload = body.data;
            if (!payload || typeof payload !== 'object') {
                return NextResponse.json({ error: 'data is required' }, { status: 400 });
            }
            // 只覆盖可编辑字段，保留 file_type/file_version/version 等元数据
            if (typeof payload.appTitle === 'string') data.appTitle = payload.appTitle;
            if (typeof payload.appImg === 'string') data.appImg = payload.appImg;
            if (Array.isArray(payload.sections)) data.sections = payload.sections;
            if (Array.isArray(payload.workflows)) {
                data.workflows = payload.workflows.map((w: any) => ({
                    viewComfyJSON: w.viewComfyJSON,
                    workflowApiJSON: w.workflowApiJSON,
                }));
            }
        } else {
            return NextResponse.json({ error: `unknown action: ${action}` }, { status: 400 });
        }

        await fs.writeFile(VIEW_COMFY_PATH, JSON.stringify(data, null, 2), 'utf8');
        return NextResponse.json({ ok: true });
    } catch (err) {
        console.error('POST /api/view-comfy failed', err);
        return NextResponse.json({ error: String(err) }, { status: 500 });
    }
}