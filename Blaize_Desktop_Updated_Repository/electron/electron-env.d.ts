/**
 * Ambient Type Declarations for Electron APIs
 *
 * Ensures complete TypeScript compilation and strict type-safety across
 * main, preload, and platform bridge files without requiring heavy binary downloads.
 */

declare module 'electron' {
  export interface App {
    whenReady(): Promise<void>;
    on(event: 'window-all-closed' | 'activate' | 'before-quit', listener: () => void): this;
    quit(): void;
    getPath(name: 'userData' | 'appData' | 'temp' | 'home'): string;
    getAppMetrics(): { pid: number; type: string; memory: { workingSetSize: number; peakWorkingSetSize: number } }[];
  }

  export interface BrowserWindowConstructorOptions {
    width?: number;
    height?: number;
    minWidth?: number;
    minHeight?: number;
    show?: boolean;
    title?: string;
    backgroundColor?: string;
    frame?: boolean;
    webPreferences?: {
      preload?: string;
      sandbox?: boolean;
      contextIsolation?: boolean;
      nodeIntegration?: boolean;
      webSecurity?: boolean;
    };
  }

  export class BrowserWindow {
    constructor(options?: BrowserWindowConstructorOptions);
    loadURL(url: string): Promise<void>;
    loadFile(filePath: string): Promise<void>;
    webContents: {
      openDevTools(): void;
      send(channel: string, ...args: unknown[]): void;
      session: {
        setPermissionRequestHandler(handler: (webContents: unknown, permission: string, callback: (permissionGranted: boolean) => void) => void): void;
      };
    };
    minimize(): void;
    maximize(): void;
    unmaximize(): void;
    isMaximized(): boolean;
    close(): void;
    isDestroyed(): boolean;
    on(event: string, listener: (...args: unknown[]) => void): this;
  }

  export interface IpcMainInvokeEvent {
    sender: BrowserWindow['webContents'];
  }

  export interface IpcMain {
    handle(channel: string, listener: (event: IpcMainInvokeEvent, ...args: any[]) => Promise<any> | any): void;
    removeHandler(channel: string): void;
  }

  export interface IpcRenderer {
    invoke(channel: string, ...args: unknown[]): Promise<unknown>;
    on(channel: string, listener: (event: unknown, ...args: unknown[]) => void): this;
    removeListener(channel: string, listener: (...args: unknown[]) => void): this;
  }

  export interface ContextBridge {
    exposeInMainWorld(apiKey: string, api: unknown): void;
  }

  export interface SafeStorage {
    isEncryptionAvailable(): boolean;
    getSelectedStorageBackend?(): 'gnome_libsecret' | 'kwallet' | 'kwallet5' | 'kwallet6' | 'basic_text' | 'unknown';
    encryptString(plainText: string): Buffer;
    decryptString(encrypted: Buffer): string;
  }

  export interface PowerMonitor {
    on(event: 'suspend' | 'resume' | 'lock-screen' | 'unlock-screen', listener: () => void): this;
  }

  export const app: App;
  export const ipcMain: IpcMain;
  export const ipcRenderer: IpcRenderer;
  export const contextBridge: ContextBridge;
  export const safeStorage: SafeStorage;
  export const powerMonitor: PowerMonitor;
}
