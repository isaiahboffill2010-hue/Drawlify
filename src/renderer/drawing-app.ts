import * as fabric from "fabric";

type Tool =
  | "select"
  | "pan"
  | "pen"
  | "pencil"
  | "highlighter"
  | "eraser"
  | "rect"
  | "ellipse"
  | "triangle"
  | "line"
  | "arrow"
  | "text";

type ShapeKind = Exclude<Tool, "select" | "pan" | "pen" | "pencil" | "highlighter" | "eraser" | "text">;

type Point = { x: number; y: number };

type ObjectSnapshot = Record<string, unknown>;

const { Canvas, Rect, Ellipse, Triangle, Line, Textbox, Group, PencilBrush, Point: FabricPoint, Image: FabricImage } = fabric as any;
const getEraserBrushCtor = () => (fabric as any)[`Eraser${"Brush"}`] as any;

const CUSTOM_PROPS = [
  "selectable",
  "evented",
  "erasable",
  "opacity",
  "fill",
  "stroke",
  "strokeWidth",
  "fontSize",
  "fontFamily",
  "textAlign",
  "src"
];

const DEFAULT_COLOR = "#1d6cf0";

export class DrawingApp {
  private readonly root: HTMLElement;
  private readonly toolbar: HTMLElement;
  private readonly canvasShell: HTMLElement;
  private readonly canvasElement: HTMLCanvasElement;
  private readonly fileInput: HTMLInputElement;
  private readonly canvas: any;
  private readonly history: string[] = [];
  private readonly redoStack: string[] = [];
  private readonly toolbarButtons = new Map<string, HTMLButtonElement>();
  private ro!: ResizeObserver;
  private activeTool: Tool = "select";
  private currentColor = DEFAULT_COLOR;
  private currentFill = "#ffffff";
  private currentStrokeWidth = 5;
  private currentOpacity = 1;
  private isRestoring = false;
  private isDrawingShape = false;
  private shapeStart: Point | null = null;
  private shapePreview: any = null;
  private panStart: Point | null = null;
  private panViewportStart: number[] | null = null;
  private copiedObjects: ObjectSnapshot[] | null = null;
  private lastZoom = 1;

  constructor(root: HTMLElement) {
    this.root = root;
    this.root.innerHTML = "";

    const toolbar = document.createElement("div");
    toolbar.className = "toolbar";
    this.toolbar = toolbar;

    const canvasShell = document.createElement("div");
    canvasShell.className = "canvas-shell";
    this.canvasShell = canvasShell;

    const canvas = document.createElement("canvas");
    canvas.id = "drawlify-canvas";
    canvas.width = 1920;
    canvas.height = 1080;
    this.canvasElement = canvas;
    canvasShell.appendChild(canvas);

    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.accept = "image/*";
    fileInput.className = "hidden-input";
    this.fileInput = fileInput;

    root.append(toolbar, canvasShell, fileInput);

    this.canvas = new Canvas(canvas, {
      backgroundColor: "#ffffff",
      selection: true,
      preserveObjectStacking: true,
      stopContextMenu: true,
      fireRightClick: false,
      isDrawingMode: false
    });

    this.canvas.freeDrawingCursor = "crosshair";
    this.canvas.uniScaleTransform = true;

    this.buildToolbar();
    this.attachCanvasEvents();
    this.attachGlobalShortcuts();
    this.setupResizeObserver();

    this.setTool("select");
    this.resizeCanvas();
    this.captureHistory();
  }

  private buildToolbar() {
    this.toolbar.append(
      this.group("Selection", [
        this.toolButton("Select", "select"),
        this.toolButton("Pan", "pan")
      ]),
      this.group("Draw", [
        this.toolButton("Pen", "pen"),
        this.toolButton("Pencil", "pencil"),
        this.toolButton("Highlighter", "highlighter"),
        this.toolButton("Eraser", "eraser")
      ]),
      this.group("Shapes", [
        this.toolButton("Rect", "rect"),
        this.toolButton("Circle", "ellipse"),
        this.toolButton("Triangle", "triangle"),
        this.toolButton("Line", "line"),
        this.toolButton("Arrow", "arrow")
      ]),
      this.group("Content", [
        this.toolButton("Text", "text"),
        this.actionButton("Image", () => this.fileInput.click())
      ]),
      this.group("Style", [
        this.colorField("Color", this.currentColor, (value) => {
          this.currentColor = value;
          this.applyBrushSettings();
          this.applyActiveObjectStyle();
        }),
        this.colorField("Fill", this.currentFill, (value) => {
          this.currentFill = value;
          this.applyActiveObjectStyle();
        }),
        this.rangeField("Width", 1, 48, this.currentStrokeWidth, (value) => {
          this.currentStrokeWidth = value;
          this.applyBrushSettings();
          this.applyActiveObjectStyle();
        }),
        this.rangeField("Opacity", 10, 100, Math.round(this.currentOpacity * 100), (value) => {
          this.currentOpacity = value / 100;
          this.applyBrushSettings();
          this.applyActiveObjectStyle();
        })
      ]),
      this.group("Edit", [
        this.actionButton("Undo", () => this.undo()),
        this.actionButton("Redo", () => this.redo()),
        this.actionButton("Copy", () => this.copySelection()),
        this.actionButton("Paste", () => this.pasteSelection()),
        this.actionButton("Delete", () => this.deleteSelection()),
        this.actionButton("Front", () => this.bringToFront()),
        this.actionButton("Back", () => this.sendToBack()),
        this.actionButton("Clear", () => this.clearCanvas())
      ]),
      this.group("Canvas", [
        this.actionButton("Zoom +", () => this.zoom(1.12)),
        this.actionButton("Zoom -", () => this.zoom(0.9)),
        this.actionButton("Reset", () => this.resetZoom()),
        this.actionButton("Fit", () => this.fitToScreen())
      ]),
      this.spacer()
    );

    this.fileInput.addEventListener("change", () => this.handleImageUpload());
  }

  private group(title: string, children: HTMLElement[]) {
    const group = document.createElement("div");
    group.className = "toolbar-group";

    const label = document.createElement("span");
    label.className = "toolbar-group-title";
    label.textContent = title;
    group.appendChild(label);

    for (const child of children) {
      group.appendChild(child);
    }

    return group;
  }

  private spacer() {
    const spacer = document.createElement("div");
    spacer.className = "toolbar-spacer";
    return spacer;
  }

  private toolButton(label: string, tool: Tool) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "tool-button";
    button.textContent = label;
    button.addEventListener("click", () => this.setTool(tool));
    this.toolbarButtons.set(tool, button);
    return button;
  }

  private actionButton(label: string, handler: () => void) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "action-button";
    button.textContent = label;
    button.addEventListener("click", handler);
    return button;
  }

  private colorField(label: string, initialValue: string, onChange: (value: string) => void) {
    const field = document.createElement("label");
    field.className = "toolbar-field";

    const title = document.createElement("span");
    title.textContent = label;
    field.appendChild(title);

    const input = document.createElement("input");
    input.type = "color";
    input.value = initialValue;
    input.addEventListener("input", () => onChange(input.value));
    field.appendChild(input);

    return field;
  }

  private rangeField(
    label: string,
    min: number,
    max: number,
    value: number,
    onChange: (value: number) => void
  ) {
    const field = document.createElement("label");
    field.className = "toolbar-field";

    const title = document.createElement("span");
    title.textContent = label;
    field.appendChild(title);

    const input = document.createElement("input");
    input.type = "range";
    input.min = String(min);
    input.max = String(max);
    input.value = String(value);
    input.addEventListener("input", () => onChange(Number(input.value)));
    field.appendChild(input);

    return field;
  }

  private setupResizeObserver() {
    this.ro = new ResizeObserver(() => this.resizeCanvas());
    this.ro.observe(this.canvasShell);
  }

  private resizeCanvas() {
    const rect = this.canvasShell.getBoundingClientRect();
    const width = Math.max(1, Math.floor(rect.width));
    const height = Math.max(1, Math.floor(rect.height));

    this.canvas.setWidth(width);
    this.canvas.setHeight(height);
    this.canvas.calcOffset();
    this.fitToScreen();
  }

  private attachCanvasEvents() {
    this.canvas.on("mouse:down", (event: any) => this.onPointerDown(event));
    this.canvas.on("mouse:move", (event: any) => this.onPointerMove(event));
    this.canvas.on("mouse:up", (event: any) => this.onPointerUp(event));
    this.canvas.on("path:created", () => this.captureHistory());
    this.canvas.on("object:added", () => this.queueHistoryCapture());
    this.canvas.on("object:modified", () => this.queueHistoryCapture());
    this.canvas.on("object:removed", () => this.queueHistoryCapture());
    this.canvas.on("selection:created", () => this.syncToolbarState());
    this.canvas.on("selection:updated", () => this.syncToolbarState());
    this.canvas.on("selection:cleared", () => this.syncToolbarState());
    this.canvas.on("mouse:dblclick", (event: any) => this.onDoubleClick(event));
  }

  private attachGlobalShortcuts() {
    window.addEventListener("keydown", (event) => {
      const key = event.key.toLowerCase();

      if ((event.ctrlKey || event.metaKey) && key === "z") {
        event.preventDefault();
        if (event.shiftKey) {
          this.redo();
        } else {
          this.undo();
        }
      }

      if ((event.ctrlKey || event.metaKey) && key === "c") {
        event.preventDefault();
        this.copySelection();
      }

      if ((event.ctrlKey || event.metaKey) && key === "v") {
        event.preventDefault();
        this.pasteSelection();
      }

      if (key === "delete" || key === "backspace") {
        if (this.activeTool === "text" && this.canvas.getActiveObject()?.isEditing) {
          return;
        }

        event.preventDefault();
        this.deleteSelection();
      }
    });
  }

  private setTool(tool: Tool) {
    this.activeTool = tool;
    this.updateToolUI();

    const isDrawingTool = tool === "pen" || tool === "pencil" || tool === "highlighter" || tool === "eraser";
    this.canvas.isDrawingMode = isDrawingTool;
    this.canvas.selection = tool === "select";
    this.canvas.defaultCursor = tool === "pan" ? "grab" : tool === "eraser" ? "crosshair" : "default";

    if (isDrawingTool) {
      this.applyBrushSettings();
    }

    if (tool !== "pan") {
      this.canvasShell.classList.remove("dragging");
    }

    if (tool === "select") {
      this.canvas.discardActiveObject();
      this.canvas.requestRenderAll();
    }
  }

  private updateToolUI() {
    for (const [tool, button] of this.toolbarButtons.entries()) {
      button.classList.toggle("active", tool === this.activeTool);
    }
  }

  private applyBrushSettings() {
    if (!this.canvas.freeDrawingBrush) {
      const BrushClass = PencilBrush || fabric.PencilBrush;
      this.canvas.freeDrawingBrush = new BrushClass(this.canvas);
    }

    const brush = this.canvas.freeDrawingBrush;
    const rgba = this.hexToRgba(this.currentColor, this.currentOpacity);

    if (this.activeTool === "eraser") {
      const EraserBrushCtor = getEraserBrushCtor();
      if (EraserBrushCtor) {
        this.canvas.freeDrawingBrush = new EraserBrushCtor(this.canvas);
        this.canvas.freeDrawingBrush.width = Math.max(12, this.currentStrokeWidth * 2);
      } else {
        brush.color = "rgba(255,255,255,1)";
        brush.width = Math.max(12, this.currentStrokeWidth * 2);
      }
    } else {
      this.canvas.freeDrawingBrush = new PencilBrush(this.canvas);
      this.canvas.freeDrawingBrush.color = rgba;
      this.canvas.freeDrawingBrush.width = this.currentStrokeWidth;
      this.canvas.freeDrawingBrush.decimate = this.activeTool === "pencil" ? 0.5 : 0.1;
      this.canvas.freeDrawingBrush.shadow =
        this.activeTool === "highlighter"
          ? new fabric.Shadow({
              color: this.hexToRgba(this.currentColor, Math.min(this.currentOpacity, 0.28)),
              blur: 0,
              offsetX: 0,
              offsetY: 0
            })
          : null;
    }

    this.canvas.freeDrawingBrush.limitedToCanvasSize = true;
  }

  private onPointerDown(event: any) {
    const pointer = this.canvas.getPointer(event.e);

    if (this.activeTool === "text") {
      const text = new Textbox("Double tap to edit", {
        left: pointer.x,
        top: pointer.y,
        originX: "center",
        originY: "center",
        fontFamily: "Inter, Segoe UI, sans-serif",
        fontSize: 32,
        fill: this.currentColor,
        editable: true,
        selectable: true,
        evented: true,
        transparentCorners: false,
        cornerStyle: "circle",
        cornerColor: this.currentColor,
        cornerSize: 14,
        padding: 8
      });

      this.canvas.add(text);
      this.canvas.setActiveObject(text);
      text.enterEditing?.();
      text.selectAll?.();
      this.canvas.requestRenderAll();
      this.captureHistory();
      return;
    }

    if (this.activeTool === "pan") {
      this.panStart = pointer;
      this.panViewportStart = [...(this.canvas.viewportTransform || [1, 0, 0, 1, 0, 0])];
      this.canvasShell.classList.add("dragging");
      this.canvas.selection = false;
      return;
    }

    if (!this.isShapeTool(this.activeTool)) {
      return;
    }

    this.isDrawingShape = true;
    this.shapeStart = pointer;
    this.shapePreview = this.createShapePreview(this.activeTool, pointer);
    if (this.shapePreview) {
      this.canvas.add(this.shapePreview);
      this.canvas.setActiveObject(this.shapePreview);
    }
  }

  private onPointerMove(event: any) {
    const pointer = this.canvas.getPointer(event.e);

    if (this.activeTool === "pan" && this.panStart && this.panViewportStart) {
      const dx = pointer.x - this.panStart.x;
      const dy = pointer.y - this.panStart.y;
      const viewport = [...this.panViewportStart] as number[];
      viewport[4] = (viewport[4] ?? 0) + dx;
      viewport[5] = (viewport[5] ?? 0) + dy;
      this.canvas.setViewportTransform(viewport);
      this.canvas.requestRenderAll();
      return;
    }

    if (!this.isDrawingShape || !this.shapeStart || !this.shapePreview) {
      return;
    }

    this.updateShapePreview(this.activeTool as ShapeKind, this.shapePreview, this.shapeStart, pointer);
    this.canvas.requestRenderAll();
  }

  private onPointerUp(_event: any) {
    if (this.activeTool === "pan") {
      this.panStart = null;
      this.panViewportStart = null;
      this.canvasShell.classList.remove("dragging");
      return;
    }

    if (!this.isDrawingShape) {
      return;
    }

    this.isDrawingShape = false;
    this.shapeStart = null;

    if (this.shapePreview) {
      this.canvas.setActiveObject(this.shapePreview);
      this.shapePreview.setCoords?.();
      this.shapePreview = null;
      this.captureHistory();
    }
  }

  private onDoubleClick(event: any) {
    const target = event.target || this.canvas.getActiveObject();
    if (!target) {
      return;
    }

    if (target.type === "textbox") {
      target.enterEditing?.();
      target.selectAll?.();
      this.canvas.requestRenderAll();
    }
  }

  private createShapePreview(tool: ShapeKind, pointer: Point) {
    const shared = {
      left: pointer.x,
      top: pointer.y,
      fill: this.currentFill === "#ffffff" ? "rgba(255,255,255,0.2)" : this.hexToRgba(this.currentFill, this.currentOpacity),
      stroke: this.currentColor,
      strokeWidth: this.currentStrokeWidth,
      selectable: true,
      evented: true,
      transparentCorners: false,
      cornerStyle: "circle",
      cornerColor: this.currentColor,
      cornerStrokeColor: "#ffffff",
      cornerSize: 14,
      padding: 6
    };

    if (tool === "rect") {
      return new Rect({
        ...shared,
        width: 1,
        height: 1
      });
    }

    if (tool === "ellipse") {
      return new Ellipse({
        ...shared,
        originX: "center",
        originY: "center",
        rx: 1,
        ry: 1
      });
    }

    if (tool === "triangle") {
      return new Triangle({
        ...shared,
        width: 1,
        height: 1
      });
    }

    if (tool === "line") {
      return new Line([pointer.x, pointer.y, pointer.x, pointer.y], {
        stroke: this.currentColor,
        strokeWidth: this.currentStrokeWidth,
        strokeLineCap: "round",
        strokeLineJoin: "round"
      });
    }

    if (tool === "arrow") {
      const line = new Line([pointer.x, pointer.y, pointer.x, pointer.y], {
        stroke: this.currentColor,
        strokeWidth: this.currentStrokeWidth,
        strokeLineCap: "round",
        strokeLineJoin: "round",
        selectable: false,
        evented: false
      });
      const head = new Triangle({
        left: pointer.x,
        top: pointer.y,
        width: Math.max(18, this.currentStrokeWidth * 2),
        height: Math.max(18, this.currentStrokeWidth * 2),
        fill: this.currentColor,
        angle: 90,
        originX: "center",
        originY: "center",
        selectable: false,
        evented: false
      });
      return new Group([line, head], {
        selectable: true,
        evented: true
      });
    }

    return null;
  }

  private updateShapePreview(tool: ShapeKind, object: any, start: Point, current: Point) {
    const width = current.x - start.x;
    const height = current.y - start.y;
    const left = Math.min(start.x, current.x);
    const top = Math.min(start.y, current.y);

    if (tool === "rect" || tool === "triangle") {
      object.set({
        left,
        top,
        width: Math.max(1, Math.abs(width)),
        height: Math.max(1, Math.abs(height)),
        originX: "left",
        originY: "top"
      });
    }

    if (tool === "ellipse") {
      object.set({
        left: start.x + width / 2,
        top: start.y + height / 2,
        rx: Math.max(1, Math.abs(width) / 2),
        ry: Math.max(1, Math.abs(height) / 2),
        originX: "center",
        originY: "center"
      });
    }

    if (tool === "line") {
      object.set({
        x1: start.x,
        y1: start.y,
        x2: current.x,
        y2: current.y
      });
    }

    if (tool === "arrow" && object.type === "group") {
      const [line, head] = object.getObjects();
      line.set({ x1: start.x, y1: start.y, x2: current.x, y2: current.y });
      const angle = (Math.atan2(current.y - start.y, current.x - start.x) * 180) / Math.PI + 90;
      head.set({
        left: current.x,
        top: current.y,
        angle
      });
      object._calcBounds?.();
      object.setCoords?.();
    }

    object.setCoords?.();
  }

  private isShapeTool(tool: Tool): tool is ShapeKind {
    return tool === "rect" || tool === "ellipse" || tool === "triangle" || tool === "line" || tool === "arrow";
  }

  private applyActiveObjectStyle() {
    const objects = this.canvas.getActiveObjects();
    if (!objects.length) {
      return;
    }

    const stroke = this.currentColor;
    const fill = this.hexToRgba(this.currentFill, this.currentOpacity);

    for (const object of objects) {
      object.set({
        stroke,
        fill: object.type === "line" ? "" : fill,
        opacity: this.currentOpacity,
        strokeWidth: this.currentStrokeWidth
      });

      if (object.type === "textbox") {
        object.set({
          fill: stroke,
          fontSize: Math.max(object.fontSize || 24, 24)
        });
      }

      if (object.type === "image") {
        object.set({ opacity: this.currentOpacity });
      }

      object.setCoords?.();
    }

    this.canvas.requestRenderAll();
    this.captureHistory();
  }

  private syncToolbarState() {
    const active = this.canvas.getActiveObject();
    if (!active) {
      return;
    }

    const stroke = (active.stroke as string | undefined) || this.currentColor;
    const fill = (active.fill as string | undefined) || this.currentFill;

    this.currentColor = stroke.startsWith("rgba") ? this.currentColor : stroke;
    this.currentFill = fill.startsWith("rgba") ? this.currentFill : fill;
    this.updateToolUI();
  }

  private deleteSelection() {
    const objects = this.canvas.getActiveObjects();
    if (!objects.length) {
      return;
    }

    objects.forEach((object: any) => this.canvas.remove(object));
    this.canvas.discardActiveObject();
    this.canvas.requestRenderAll();
    this.captureHistory();
  }

  private bringToFront() {
    this.applyToSelection((object: any) => this.canvas.bringToFront(object));
  }

  private sendToBack() {
    this.applyToSelection((object: any) => this.canvas.sendToBack(object));
  }

  private applyToSelection(action: (object: any) => void) {
    const objects = this.canvas.getActiveObjects();
    if (!objects.length) {
      return;
    }

    objects.forEach((object: any) => action(object));
    this.canvas.requestRenderAll();
    this.captureHistory();
  }

  private clearCanvas() {
    this.canvas.getObjects().slice().forEach((object: any) => this.canvas.remove(object));
    this.canvas.discardActiveObject();
    this.canvas.requestRenderAll();
    this.captureHistory();
  }

  private copySelection() {
    const objects = this.canvas.getActiveObjects();
    if (!objects.length) {
      return;
    }

    this.copiedObjects = objects.map((object: any) => object.toObject(CUSTOM_PROPS));
  }

  private async pasteSelection() {
    if (!this.copiedObjects?.length) {
      return;
    }

    const pasted: any[] = [];
    for (const snapshot of this.copiedObjects) {
      const created = await this.reviveObject(snapshot);
      if (created) {
        created.set({
          left: (created.left || 0) + 24,
          top: (created.top || 0) + 24
        });
        this.canvas.add(created);
        pasted.push(created);
      }
    }

    if (pasted.length) {
      if (pasted.length === 1) {
        this.canvas.setActiveObject(pasted[0]);
      } else if (fabric.ActiveSelection) {
        this.canvas.setActiveObject(new fabric.ActiveSelection(pasted, { canvas: this.canvas }));
      }
      this.canvas.requestRenderAll();
      this.captureHistory();
    }
  }

  private async reviveObject(snapshot: ObjectSnapshot) {
    const type = snapshot.type as string | undefined;

    if (type === "rect") {
      return new Rect(snapshot);
    }

    if (type === "ellipse") {
      return new Ellipse(snapshot);
    }

    if (type === "triangle") {
      return new Triangle(snapshot);
    }

    if (type === "line") {
      return new Line([snapshot.x1 as number, snapshot.y1 as number, snapshot.x2 as number, snapshot.y2 as number], snapshot);
    }

    if (type === "textbox") {
      return new Textbox((snapshot.text as string) || "", snapshot);
    }

    if (type === "image") {
      const src = snapshot.src as string;
      if (!src) {
        return null;
      }

      return await FabricImage.fromURL(src, snapshot);
    }

    if (type === "group" && Array.isArray(snapshot.objects)) {
      const children: any[] = [];
      for (const child of snapshot.objects as ObjectSnapshot[]) {
        const revived = await this.reviveObject(child);
        if (revived) {
          children.push(revived);
        }
      }

      if (children.length) {
        return new Group(children, snapshot);
      }
    }

    return null;
  }

  private handleImageUpload() {
    const file = this.fileInput.files?.[0];
    if (!file) {
      return;
    }

    const url = URL.createObjectURL(file);
    void (async () => {
      const image = await FabricImage.fromURL(url, {});
      image.set({
        left: this.canvas.getWidth() / 2,
        top: this.canvas.getHeight() / 2,
        originX: "center",
        originY: "center",
        selectable: true,
        evented: true
      });

      const scale = Math.min(0.7, Math.min(this.canvas.getWidth() / image.width, this.canvas.getHeight() / image.height, 1));
      image.scale(scale);
      this.canvas.add(image);
      this.canvas.setActiveObject(image);
      this.canvas.requestRenderAll();
      this.captureHistory();
      URL.revokeObjectURL(url);
      this.fileInput.value = "";
    })();
  }

  private undo() {
    if (this.history.length <= 1) {
      return;
    }

    const current = this.history.pop();
    if (current) {
      this.redoStack.push(current);
    }

    const previous = this.history[this.history.length - 1];
    if (previous) {
      this.restoreHistory(previous);
    }
  }

  private redo() {
    const next = this.redoStack.pop();
    if (!next) {
      return;
    }

    this.history.push(next);
    this.restoreHistory(next);
  }

  private queueHistoryCapture() {
    if (this.isRestoring) {
      return;
    }

    window.setTimeout(() => this.captureHistory(), 0);
  }

  private captureHistory() {
    if (this.isRestoring) {
      return;
    }

    const snapshot = JSON.stringify(this.canvas.toJSON(CUSTOM_PROPS));
    const last = this.history[this.history.length - 1];
    if (snapshot === last) {
      return;
    }

    this.history.push(snapshot);
    this.redoStack.length = 0;
  }

  private restoreHistory(snapshot: string) {
    this.isRestoring = true;
    this.canvas.loadFromJSON(snapshot, () => {
      this.canvas.renderAll();
      this.isRestoring = false;
      this.canvas.calcOffset();
    });
  }

  private zoom(factor: number) {
    const zoom = Math.max(0.25, Math.min(4, this.lastZoom * factor));
    const center = new FabricPoint(this.canvas.getWidth() / 2, this.canvas.getHeight() / 2);
    this.canvas.zoomToPoint(center, zoom);
    this.lastZoom = zoom;
    this.canvas.requestRenderAll();
  }

  private resetZoom() {
    this.canvas.setViewportTransform([1, 0, 0, 1, 0, 0]);
    this.lastZoom = 1;
    this.canvas.requestRenderAll();
  }

  private fitToScreen() {
    this.resetZoom();
  }

  private hexToRgba(hex: string, alpha: number) {
    const normalized = hex.replace("#", "");
    const full = normalized.length === 3 ? normalized.split("").map((part) => `${part}${part}`).join("") : normalized;
    const value = Number.parseInt(full, 16);
    const r = (value >> 16) & 255;
    const g = (value >> 8) & 255;
    const b = value & 255;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  destroy() {
    this.ro.disconnect();
    this.canvas.dispose();
  }
}
