// Small inline icons (16×16, currentColor).

const svg = (path: string) =>
  `<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;

export const icons = {
  plus: svg('<path d="M8 3.5v9M3.5 8h9"/>'),
  minus: svg('<path d="M3.5 8h9"/>'),
  fit: svg('<path d="M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10"/>'),
  expand: svg('<path d="M9.5 2.5h4v4M13.5 2.5 9 7M6.5 13.5h-4v-4M2.5 13.5 7 9"/>'),
  collapse: svg('<path d="M13.5 2.5 9.5 6.5M9.5 3v3.5H13M2.5 13.5l4-4M6.5 13V9.5H3"/>'),
  more: '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" fill="currentColor"><circle cx="3.5" cy="8" r="1.3"/><circle cx="8" cy="8" r="1.3"/><circle cx="12.5" cy="8" r="1.3"/></svg>',
  close: svg('<path d="M4 4l8 8M12 4l-8 8"/>'),
  search: svg('<circle cx="7" cy="7" r="4.25"/><path d="M10.2 10.2 13.5 13.5"/>'),
  up: svg('<path d="M4 10l4-4 4 4"/>'),
  down: svg('<path d="M4 6l4 4 4-4"/>'),
  left: svg('<path d="M10 4 6 8l4 4"/>'),
  right: svg('<path d="M6 4l4 4-4 4"/>'),
  map: svg('<rect x="2.5" y="2.5" width="11" height="11" rx="1.5"/><rect x="7.5" y="7.5" width="4" height="4" rx=".5"/>'),
  fullscreen: svg('<path d="M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10"/>'),
  warning: '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M6.457 1.047c.659-1.234 2.427-1.234 3.086 0l6.082 11.378A1.75 1.75 0 0 1 14.082 15H1.918a1.75 1.75 0 0 1-1.543-2.575Zm1.763.707a.25.25 0 0 0-.44 0L1.698 13.132a.25.25 0 0 0 .22.368h12.164a.25.25 0 0 0 .22-.368Zm.53 3.996v2.5a.75.75 0 0 1-1.5 0v-2.5a.75.75 0 0 1 1.5 0ZM9 11a1 1 0 1 1-2 0 1 1 0 0 1 2 0Z"/></svg>',
  check: svg('<path d="M3 8.5 6.5 12 13 4.5"/>'),
};
