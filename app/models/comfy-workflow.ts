import path from "node:path";
import crypto from 'node:crypto';
import type { IInput } from "@/app/interfaces/input";
import * as constants from "@/app/constants";
import { getComfyUIRandomSeed } from "@/lib/utils";
import { ComfyUIAPIService } from "../services/comfyui-api-service";

const COMFY_WORKFLOWS_DIR = path.join(process.cwd(), "comfy", "workflows");

const LOADER_CLASS_TYPES = new Set([
  "LoadImage",
  "LoadImageMask",
  "loadImage_ViewComfy",
  "VHS_LoadVideo",
  "LoadVideo",
  "LoadAudio",
]);

export class ComfyWorkflow {
   
  private workflow: { [key: string]: any };
  private workflowFileName: string;
  private workflowFilePath: string;
  private id: string;

  constructor(workflow: object) {
    this.workflow = workflow;
    this.id = crypto.randomUUID();
    this.workflowFileName = `workflow_${this.id}.json`;
    this.workflowFilePath = path.join(COMFY_WORKFLOWS_DIR, this.workflowFileName);
  }

  public async setViewComfy(viewComfy: IInput[], comfyUIService: ComfyUIAPIService) {
    try {
      for (const input of viewComfy) {
        const path = input.key.split("-");
        const nodeId = path[0];
        const node = this.workflow[nodeId];
        const isEmpty = input.value === null || input.value === undefined || input.value === "";
         
        let obj: any = this.workflow;
        for (let i = 0; i < path.length - 1; i++) {
          if (i === path.length - 1) {
            continue;
          }
          obj = obj[path[i]];
        }
        if (input.value instanceof File) {
          if (path[path.length - 1] === "viewcomfymask") {
            const t0 = Date.now();
            await this.uploadMaskToComfy({
              comfyUIService,
              maskFile: input.value,
              maskKeyParam: input.key,
              viewComfy,
            });
            console.log(`[upload] mask ${input.key} 耗时 ${Date.now() - t0}ms`);
          } else {
            const t0 = Date.now();
            const fileName = `${this.getFileNamePrefix()}${input.value.name}`;
            const uploadedName = await comfyUIService.uploadToInput(input.value, fileName);
            obj[path[path.length - 1]] = uploadedName;
            console.log(`[upload] image ${input.key} (${input.value.size} 字节) 耗时 ${Date.now() - t0}ms`);
          }
        } else if (node && LOADER_CLASS_TYPES.has(node.class_type) && isEmpty) {
          // 可选参考输入为空：断开该加载节点（删除节点 + 下游连接置 null）
          this.disconnectLoaderNode(nodeId);
        } else {
          obj[path[path.length - 1]] = input.value;
        }
      }
    } catch (error) {
      console.error(error);
    }

    for (const key in this.workflow) {
      const node = this.workflow[key];
      switch (node.class_type) {
        case "SaveImage":
        case "VHS_VideoCombine":
          node.inputs.filename_prefix = this.getFileNamePrefix();
          break;

        default:
          Object.keys(node.inputs).forEach((key) => {
            if (
              constants.SEED_LIKE_INPUT_VALUES.some(str => key.includes(str))
              && node.inputs[key] === Number.MIN_VALUE
            ) {
              const newSeed = this.getNewSeed();
              node.inputs[key] = newSeed;
            }
          });
      }
    }
  }

  private disconnectLoaderNode(nodeId: string) {
    delete this.workflow[nodeId];
    for (const key in this.workflow) {
      const node = this.workflow[key];
      if (!node || !node.inputs) continue;
      for (const inputName in node.inputs) {
        const v = node.inputs[inputName];
        if (Array.isArray(v) && v.length === 2 && v[0] === nodeId) {
          node.inputs[inputName] = null;
        }
      }
    }
  }

  public getWorkflow() {
    return this.workflow;
  }

  public getWorkflowFilePath() {
    return this.workflowFilePath;
  }

  public getWorkflowFileName() {
    return this.workflowFileName;
  }

  public getFileNamePrefix() {
    return `${this.id}_`;
  }

  public getNewSeed() {
    return getComfyUIRandomSeed();
  }

  private async uploadMaskToComfy(params: {
    maskFile: File,
    maskKeyParam: string,
    viewComfy: IInput[],
    comfyUIService: ComfyUIAPIService
  }) {
    const { maskKeyParam, maskFile, viewComfy, comfyUIService } = params;
    // maskKeyParam = "<imageKey>-viewcomfymask"，例如 "643-inputs-image-viewcomfymask"
    const originalFilePath = maskKeyParam.slice(0, -"-viewcomfymask".length)
    const originalFilePathKeys = originalFilePath.split("-");

    let obj: any = this.workflow;
    for (let i = 0; i < originalFilePathKeys.length - 1; i++) {
      if (i === originalFilePathKeys.length - 1) {
        continue;
      }
      obj = obj[originalFilePathKeys[i]];
    }
    const unmaskedPath = obj[originalFilePathKeys[originalFilePathKeys.length - 1]];
    const unmaskedFilename = path.basename(unmaskedPath);
    let viewComfyInput = undefined;
    for (const input of viewComfy) {
      if (input.key === originalFilePath) {
        viewComfyInput = input;
        break;
      }
    }

    if (!viewComfyInput) {
      throw new Error("Cannot find the original parameter to map to the mask");
    }
    const originalFile = viewComfyInput.value as File;

    // clipspace 约定：把原图 + mask 写入 ComfyUI clipspace 缓存，LoadImage 节点用 clipspace/xxx [input] 读取
    const clipspaceMaskFilename = this.getMaskFilename("mask", this.id);
    await comfyUIService.uploadMask({
      maskFileName: clipspaceMaskFilename,
      maskFile,
      originalFileRef: unmaskedFilename
    });

    const clipspacePaintedFilename = this.getMaskFilename("painted", this.id);
    await comfyUIService.uploadImage({
      imageFile: originalFile,
      imageFileName: clipspacePaintedFilename,
      originalFileRef: unmaskedFilename
    });

    const clipspacePaintedMaskFilename = this.getMaskFilename("painted-masked", this.id);
    await comfyUIService.uploadMask({
      maskFileName: clipspacePaintedMaskFilename,
      maskFile,
      originalFileRef: clipspacePaintedFilename
    });

    obj[originalFilePathKeys[originalFilePathKeys.length - 1]] = "clipspace/" + clipspacePaintedMaskFilename + " [input]"
  }

  private getMaskFilename(filename: string, id: string) {
    return "clipspace-" + filename + "-" + id + ".png"
  }

}
