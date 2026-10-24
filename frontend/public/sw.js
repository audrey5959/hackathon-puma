// 只用來發「處理完畢」通知：iOS 主畫面網頁 App 與 Android Chrome 不顯示頁面直接 new Notification() 的通知。
// 沒有 Web Push，也不快取任何檔案。
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = e.notification.data?.url ?? "/";
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((tabs) => {
      const tab = tabs.find((t) => t.url.endsWith(url)) ?? tabs[0];
      return tab ? tab.focus() : self.clients.openWindow(url);
    }),
  );
});
