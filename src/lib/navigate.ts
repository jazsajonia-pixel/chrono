/** Full-page navigations, wrapped so tests can observe them (jsdom's Location can't be stubbed). */
export const browserNav = {
  assign(url: string): void {
    window.location.assign(url);
  },
  replace(url: string): void {
    window.location.replace(url);
  },
};
