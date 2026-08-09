export class SettingsService {

    public getComfyOutputDirectory(): string {
        if (!process.env.COMFY_OUTPUT_DIR) {
            throw new Error("COMFY_OUTPUT_DIR is not set, you need to use Full paths not relative paths");
        }
        return process.env.COMFY_OUTPUT_DIR;
    }

    public getIsViewMode(): boolean {
        return Boolean((process.env.NEXT_PUBLIC_VIEW_MODE && process.env.NEXT_PUBLIC_VIEW_MODE === "true"))
    }
}
