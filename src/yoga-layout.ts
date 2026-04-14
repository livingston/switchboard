import Yoga from "yoga-layout";
import type { Component } from "@mariozechner/pi-tui";
import { stripAnsi } from "./ansi.js";

export interface LayoutNode {
  component?: Component;
  children?: LayoutNode[];
  flexDirection?: "row" | "column";
  flexGrow?: number;
  flexShrink?: number;
  width?: number;
  height?: number;
  padding?: number;
  paddingX?: number;
  paddingY?: number;
  gap?: number;
}

export class YogaLayout implements Component {
  private tree: LayoutNode;
  private getTermHeight: () => number;

  constructor(tree: LayoutNode, getTermHeight: () => number) {
    this.tree = tree;
    this.getTermHeight = getTermHeight;
  }

  invalidate(): void {}

  render(width: number): string[] {
    const termHeight = this.getTermHeight();
    const rootYoga = this.buildNode(this.tree);
    rootYoga.setWidth(width);
    rootYoga.setHeight(termHeight);
    rootYoga.calculateLayout(width, termHeight);
    const buffer: string[] = new Array(termHeight).fill(" ".repeat(width));
    this.composite(this.tree, rootYoga, buffer, 0, 0);
    rootYoga.freeRecursive();
    return buffer;
  }

  private buildNode(node: LayoutNode) {
    const yn = Yoga.Node.create();
    if (node.flexDirection === "row") {
      yn.setFlexDirection(Yoga.FLEX_DIRECTION_ROW);
    } else {
      yn.setFlexDirection(Yoga.FLEX_DIRECTION_COLUMN);
    }
    if (node.flexGrow !== undefined) yn.setFlexGrow(node.flexGrow);
    if (node.flexShrink !== undefined) yn.setFlexShrink(node.flexShrink);
    if (node.height !== undefined) yn.setHeight(node.height);
    if (node.width !== undefined) yn.setWidth(node.width);
    if (node.padding !== undefined) yn.setPadding(Yoga.EDGE_ALL, node.padding);
    if (node.paddingX !== undefined) {
      yn.setPadding(Yoga.EDGE_LEFT, node.paddingX);
      yn.setPadding(Yoga.EDGE_RIGHT, node.paddingX);
    }
    if (node.paddingY !== undefined) {
      yn.setPadding(Yoga.EDGE_TOP, node.paddingY);
      yn.setPadding(Yoga.EDGE_BOTTOM, node.paddingY);
    }
    if (node.gap !== undefined) yn.setGap(Yoga.GUTTER_ALL, node.gap);
    if (node.children) {
      for (let i = 0; i < node.children.length; i++) {
        yn.insertChild(this.buildNode(node.children[i]), i);
      }
    }
    return yn;
  }

  private composite(
    node: LayoutNode,
    yoga: ReturnType<typeof Yoga.Node.create>,
    buffer: string[],
    offsetX: number,
    offsetY: number
  ): void {
    const x = Math.round(yoga.getComputedLeft()) + offsetX;
    const y = Math.round(yoga.getComputedTop()) + offsetY;
    const w = Math.round(yoga.getComputedWidth());
    const h = Math.round(yoga.getComputedHeight());
    if (node.component) {
      const lines = node.component.render(w);
      for (let row = 0; row < h; row++) {
        const bufRow = y + row;
        if (bufRow < 0 || bufRow >= buffer.length) continue;
        const line = row < lines.length ? lines[row] : " ".repeat(w);
        const before = buffer[bufRow].slice(0, x);
        const after = buffer[bufRow].slice(x + w);
        buffer[bufRow] = before + line + " ".repeat(Math.max(0, w - stripAnsi(line).length)) + after;
      }
    }
    if (node.children) {
      for (let i = 0; i < node.children.length; i++) {
        this.composite(node.children[i], yoga.getChild(i), buffer, x, y);
      }
    }
  }
}
