import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { IPC_CHANNELS, type Api, type IpcChannel } from '@shared/ipc'

const allowed = new Set<string>(IPC_CHANNELS)

const api: Api = {
  invoke(channel, ...args) {
    if (!allowed.has(channel)) throw new Error(`Unknown IPC channel: ${channel}`)
    return ipcRenderer.invoke(channel as IpcChannel, ...args)
  },
  on(event, listener) {
    const wrapped = (_event: IpcRendererEvent, payload: Parameters<typeof listener>[0]): void =>
      listener(payload)
    ipcRenderer.on(event, wrapped)
    return () => ipcRenderer.removeListener(event, wrapped)
  }
}

contextBridge.exposeInMainWorld('api', api)
