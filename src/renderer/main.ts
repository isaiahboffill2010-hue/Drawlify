import "./style.css";
import { DrawingApp } from "./drawing-app";

const root = document.getElementById("app");

if (!root) {
  throw new Error("App root not found");
}

new DrawingApp(root);
