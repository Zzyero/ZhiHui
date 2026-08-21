import path from "node:path";
import fs from "node:fs/promises";

export type PromptMediaType = "image" | "video" | "audio";

export interface IPromptSkill {
  name: string;
  description: string;
  mediaType: PromptMediaType;
  titleKeywords?: string[];
  file: string;
}

const skillsDir = () => path.join(process.cwd(), "skills");

let manifestCache: IPromptSkill[] | undefined;

/** 读取 skills/index.json 清单 */
export async function listSkills(): Promise<IPromptSkill[]> {
  if (manifestCache) return manifestCache;
  try {
    const raw = await fs.readFile(path.join(skillsDir(), "index.json"), "utf8");
    const data = JSON.parse(raw);
    manifestCache = (data?.skills || []) as IPromptSkill[];
  } catch {
    manifestCache = [];
  }
  return manifestCache!;
}

/** 读取某个 skill 的正文 */
export async function readSkill(name: string): Promise<string | undefined> {
  const skills = await listSkills();
  const skill = skills.find((s) => s.name === name);
  if (!skill) return undefined;
  try {
    return await fs.readFile(path.join(skillsDir(), skill.file), "utf8");
  } catch {
    return undefined;
  }
}

/**
 * 根据工作流类型 + 标题，找到对应的提示词 skill。
 * 规则：同 mediaType 内，优先匹配 titleKeywords，其次取无关键词的默认 skill。
 */
export function getSkillForWorkflow(mediaType: string, title: string, skills: IPromptSkill[]): IPromptSkill | undefined {
  const candidates = skills.filter((s) => s.mediaType === mediaType);
  if (candidates.length === 0) return undefined;
  const t = title.toLowerCase();
  const byKeyword = candidates.find((s) => s.titleKeywords?.some((k) => t.includes(k.toLowerCase())));
  if (byKeyword) return byKeyword;
  return candidates.find((s) => !s.titleKeywords);
}
