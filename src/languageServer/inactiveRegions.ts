import * as vscode from 'vscode';
import { NotificationType } from 'vscode-languageclient/node';

export interface InputRegion {
    startLine: number;
    startCol: number;
    endLine: number;
    endCol: number;
}

export interface InactiveRegionParams {
    uri: string;
    fileVersion: number;
    regions: InputRegion[];
}

interface DecorationRangesPair {
    decoration: vscode.TextEditorDecorationType;
    ranges: vscode.Range[];
}

export const InactiveRegionNotification: NotificationType<InactiveRegionParams> =
    new NotificationType<InactiveRegionParams>('pasls.inactiveRegions');

export class InactiveRegions {
    private readonly decorations = new Map<string, DecorationRangesPair>();

    public update(params: InactiveRegionParams): void {
        const opacity = 0.3;
        const decoration = vscode.window.createTextEditorDecorationType({
            opacity: opacity.toString(),
            backgroundColor: undefined,
            color: undefined,
            rangeBehavior: vscode.DecorationRangeBehavior.OpenOpen
        });

        const ranges = params.regions.map(region =>
            new vscode.Range(region.startLine - 1, region.startCol - 1, region.endLine - 1, region.endCol - 1)
        );

        const existing = this.decorations.get(params.uri);
        if (existing) {
            existing.decoration.dispose();
            existing.decoration = decoration;
            existing.ranges = ranges;
        } else {
            this.decorations.set(params.uri, { decoration, ranges });
        }

        for (const editor of vscode.window.visibleTextEditors.filter(editor => editor.document.uri.toString() === params.uri)) {
            editor.setDecorations(decoration, ranges);
        }
    }

    public applyToEditor(editor: vscode.TextEditor): void {
        const cached = this.decorations.get(editor.document.uri.toString());
        if (cached) {
            editor.setDecorations(cached.decoration, cached.ranges);
        }
    }

    public clear(): void {
        this.decorations.forEach(value => value.decoration.dispose());
        this.decorations.clear();
    }
}
