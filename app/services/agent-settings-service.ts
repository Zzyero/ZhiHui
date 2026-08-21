import path from "node:path";
import fs from "node:fs/promises";

export interface IAgentSettings {
    /** OpenAI 兼容接口地址，例如 Ollama http://localhost:11434/v1 / vLLM http://localhost:8000/v1 */
    baseUrl: string;
    /** API Key（本地模型可留空） */
    apiKey: string;
    /** 模型名，例如 qwen2.5:7b / deepseek-chat */
    model: string;
}

const DEFAULT_SETTINGS: IAgentSettings = {
    baseUrl: "http://localhost:11434/v1",
    apiKey: "",
    model: "",
};

const DEFAULT_DATA_DIR = path.join(process.cwd(), "data");

/**
 * 智能体模型配置：持久化到 data/settings.json（gitignored）。
 */
class AgentSettingsService {
    private filePath: string;
    private cache: IAgentSettings | undefined;

    constructor() {
        this.filePath = path.join(process.env.DATA_DIR || DEFAULT_DATA_DIR, "settings.json");
    }

    private async load(): Promise<IAgentSettings> {
        if (this.cache) return this.cache;
        let data: IAgentSettings;
        try {
            const raw = await fs.readFile(this.filePath, "utf8");
            data = { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
        } catch {
            data = { ...DEFAULT_SETTINGS };
        }
        this.cache = data;
        return data;
    }

    private async persist(data: IAgentSettings): Promise<void> {
        this.cache = data;
        await fs.mkdir(path.dirname(this.filePath), { recursive: true });
        await fs.writeFile(this.filePath, JSON.stringify(data, null, 2), "utf8");
    }

    async getSettings(): Promise<IAgentSettings> {
        return this.load();
    }

    async saveSettings(settings: Partial<IAgentSettings>): Promise<IAgentSettings> {
        const current = await this.load();
        const next: IAgentSettings = {
            baseUrl: typeof settings.baseUrl === "string" ? settings.baseUrl : current.baseUrl,
            apiKey: typeof settings.apiKey === "string" ? settings.apiKey : current.apiKey,
            model: typeof settings.model === "string" ? settings.model : current.model,
        };
        await this.persist(next);
        return next;
    }
}

export const agentSettingsService = new AgentSettingsService();
