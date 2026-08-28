'use strict';
const { contextBridge, ipcRenderer } = require('electron');

// callback -> (kanal -> jego owinieta wersja). Sam callback to za malo jako
// klucz: ta sama funkcja moglaby byc podpieta pod dwa rozne kanaly naraz,
// a wtedy druga rejestracja nadpisywalaby w mapie owiniecie pierwszej i
// off() dla pierwszego kanalu przestawaloby dzialac.
const listeners = new Map();

contextBridge.exposeInMainWorld('nazuna', {
  invoke: (method, payload) => ipcRenderer.invoke('nazuna:invoke', method, payload),
  send: (method, payload) => ipcRenderer.send('nazuna:send', method, payload),
  on: (channel, callback) => {
    const wrapped = (_event, ...args) => callback(...args);
    ipcRenderer.on(channel, wrapped);
    let poKanale = listeners.get(callback);
    if (!poKanale) { poKanale = new Map(); listeners.set(callback, poKanale); }
    poKanale.set(channel, wrapped);
    return () => {
      ipcRenderer.removeListener(channel, wrapped);
      const m = listeners.get(callback);
      if (m) { m.delete(channel); if (!m.size) listeners.delete(callback); }
    };
  },
  off: (channel, callback) => {
    const poKanale = listeners.get(callback);
    const wrapped = poKanale && poKanale.get(channel);
    if (!wrapped) return;
    ipcRenderer.removeListener(channel, wrapped);
    poKanale.delete(channel);
    if (!poKanale.size) listeners.delete(callback);
  },
  platform: process.platform
});
