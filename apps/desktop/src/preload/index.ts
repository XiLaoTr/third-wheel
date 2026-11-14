/** Preload (sandboxed): exposes a minimal, typed API to the renderer. */
import { contextBridge, ipcRenderer } from 'electron';
import {
  IPC,
  type BridgeRendererReply,
  type BridgeRendererRequest,
  type ModelFile,
  type ModelVersionFile,
  type SaveResult,
  type VersionFileState,
  type ThirdWheelApi,
} from '../shared/ipc.js';
import type { AiActivity, ConnectResult, McpSetup } from '../shared/ai-status.js';
import { isMenuCommand } from '../shared/menu-commands.js';

const api: ThirdWheelApi = {
  setThemeSource(mode) {
    ipcRenderer.send(IPC.setThemeSource, mode);
  },
  openModelDialog(title, shownPath) {
    return ipcRenderer.invoke(IPC.openModelDialog, title, shownPath) as Promise<ModelFile | null>;
  },
  rereadModelFile(path, open) {
    return ipcRenderer.invoke(IPC.rereadModelFile, path, open) as Promise<ModelFile>;
  },
  readSidecar(modelPath) {
    return ipcRenderer.invoke(IPC.readSidecar, modelPath) as Promise<string | null>;
  },
  versionFileStates(paths) {
    return ipcRenderer.invoke(IPC.versionFileStates, paths) as Promise<VersionFileState[]>;
  },
  addNewerVersion(olderPath, link, emptyNotes) {
    return ipcRenderer.invoke(IPC.addNewerVersion, olderPath, link, emptyNotes) as Promise<void>;
  },
  editVersionLinks(path, contentHash, edit) {
    return ipcRenderer.invoke(IPC.editVersionLinks, path, contentHash, edit) as Promise<void>;
  },
  listModelVersions(modelPath) {
    return ipcRenderer.invoke(IPC.listModelVersions, modelPath) as Promise<ModelVersionFile[]>;
  },
  saveSidecar(modelPath, text, backupFirst) {
    return ipcRenderer.invoke(
      IPC.saveSidecar,
      modelPath,
      text,
      backupFirst === true,
    ) as Promise<SaveResult>;
  },
  saveSidecarSync(modelPath, text, backupFirst) {
    return ipcRenderer.sendSync(
      IPC.saveSidecarSync,
      modelPath,
      text,
      backupFirst === true,
    ) as SaveResult;
  },
  backupSidecar(modelPath) {
    return ipcRenderer.invoke(IPC.backupSidecar, modelPath) as Promise<string | null>;
  },
  onModelFile(listener) {
    ipcRenderer.on(IPC.modelFile, (_event, file: ModelFile) => {
      listener(file);
    });
  },
  sendPerfResult(result) {
    ipcRenderer.send(IPC.perfResult, result);
  },
  onBridgeRequest(handler) {
    ipcRenderer.on(IPC.bridgeRequest, (_event, req: BridgeRendererRequest) => {
      const reply = (r: BridgeRendererReply): void => {
        ipcRenderer.send(IPC.bridgeReply, r);
      };
      Promise.resolve()
        .then(() => handler(req.method, req.params))
        .then(
          (result) => {
            reply({ requestId: req.requestId, ok: true, result });
          },
          (err: unknown) => {
            reply({
              requestId: req.requestId,
              ok: false,
              message: err instanceof Error ? err.message : String(err),
            });
          },
        );
    });
  },
  getAiActivity() {
    return ipcRenderer.invoke(IPC.getAiActivity) as Promise<AiActivity>;
  },
  onAiActivity(handler) {
    ipcRenderer.on(IPC.aiActivity, (_event, activity: AiActivity) => {
      handler(activity);
    });
  },
  getMcpSetup() {
    return ipcRenderer.invoke(IPC.getMcpSetup) as Promise<McpSetup>;
  },
  findAgent(agent) {
    return ipcRenderer.invoke(IPC.findAgent, agent) as Promise<string | null>;
  },
  connectAgent(agent) {
    return ipcRenderer.invoke(IPC.connectAgent, agent) as Promise<ConnectResult>;
  },
  onShowAbout(handler) {
    ipcRenderer.on(IPC.showAbout, () => {
      handler();
    });
  },
  onMenuCommand(handler) {
    ipcRenderer.on(IPC.menuCommand, (_event, command: unknown) => {
      if (isMenuCommand(command)) handler(command);
    });
  },
  textUndoRedo(which) {
    ipcRenderer.send(IPC.textUndoRedo, which);
  },
  getAppVersion() {
    return ipcRenderer.invoke(IPC.getAppVersion) as Promise<string>;
  },
  getThirdPartyNotices() {
    return ipcRenderer.invoke(IPC.getThirdPartyNotices) as Promise<string>;
  },
};

contextBridge.exposeInMainWorld('thirdWheel', api);
