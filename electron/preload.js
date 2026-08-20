const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("drawlify", {
  appName: "Drawlify"
});
