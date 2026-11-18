/* 寰宇行動大學：手機推播通知（Web Push）的背景接收程式。只處理推播與點通知，不快取任何網頁內容。 */
/* global self, URL */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let msg = { title: "寰宇行動大學", body: "你有一則新通知", link: "/notices" };
  try {
    if (event.data) msg = Object.assign(msg, event.data.json());
  } catch {
    /* 內容格式不對就用預設文字 */
  }
  event.waitUntil(
    self.registration.showNotification(msg.title, {
      body: msg.body,
      icon: "/icon-192.png",
      badge: "/badge-96.png",
      tag: msg.link,
      data: { link: msg.link },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const link = (event.notification.data && event.notification.data.link) || "/notices";
  const url = new URL(link, self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if (c.url.startsWith(self.location.origin) && "focus" in c) {
          c.navigate(url).catch(() => undefined);
          return c.focus();
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
