import { driver } from 'driver.js';
import 'driver.js/dist/driver.css';

const SEEN_KEY = 'dd_filter_tour_seen_v1';

// localStorage can throw (private mode, blocked storage); never let that break the page.
export const hasSeenFilterTour = () => {
  try {
    return window.localStorage.getItem(SEEN_KEY) === '1';
  } catch (e) {
    return false;
  }
};

const markSeen = () => {
  try {
    window.localStorage.setItem(SEEN_KEY, '1');
  } catch (e) {
    // Ignore: worst case the tour is offered again next visit.
  }
};

const exists = (selector) => Boolean(document.querySelector(selector));

// Start the spotlight tour on the filter/review page. Steps whose target is not
// on the page (e.g. no filters for this platform) are skipped automatically.
// Pass `{ force: true }` to replay regardless of the "seen" flag.
export const startFilterTour = ({ force = false } = {}) => {
  if (!force && hasSeenFilterTour()) return null;
  // Mark as seen up front so closing, reloading or crashing never re-triggers it.
  markSeen();

  const titleEl = document.querySelector('[data-tour="table-title"]');
  const exampleTitle = titleEl ? titleEl.textContent.trim() : 'Screen Unlocks (1,728 rows)';

  const steps = [
    {
      popover: {
        title: 'Quick tour',
        description:
          'Before you decide, here is a 30-second look at how to review and control what you donate. You can skip at any time.',
      },
    },
    {
      element: '[data-tour="filters"]',
      popover: {
        title: 'Filter by date',
        description:
          'Limit your donation to a time window, or use the “Last 7/30 days” shortcuts. Rows outside the range are not donated.',
        side: 'bottom',
      },
    },
    {
      element: '[data-tour="exclude"]',
      popover: {
        title: 'Exclude apps',
        description:
          'Pick any apps (or activity types) you do not want to share. Everything linked to them is removed from your donation.',
        side: 'bottom',
      },
    },
    {
      element: '[data-tour="table-title"]',
      popover: {
        title: 'What the headings mean',
        description:
          `Each heading is one table from your upload, followed by how many rows it contains, for example “${exampleTitle}”. ` +
          'The row count updates as you filter or delete.',
        side: 'bottom',
      },
    },
    {
      element: '[data-tour="grid"] .MuiDataGrid-columnHeaderCheckbox',
      popover: {
        title: 'Remove individual rows',
        description:
          'Tick the checkbox next to any row (or the top box to select a page). A red “Delete selected rows” button then appears under the table. Deleted rows are never donated.',
        side: 'right',
      },
    },
    {
      element: '[data-tour="grid"] .MuiTablePagination-root',
      popover: {
        title: 'Browse your data',
        description:
          'Use “Rows per page” to show more rows at once and the arrows to move to the next page, so you can check everything you are about to share.',
        side: 'top',
      },
    },
    {
      element: '[data-tour="decision"]',
      popover: {
        title: 'Your decision',
        description:
          '“Yes, donate” sends exactly what you see here and saves you a copy. “No” sends nothing. Either choice is fine.',
        side: 'top',
      },
    },
  ].filter((s) => !s.element || exists(s.element));

  const tour = driver({
    showProgress: true,
    allowClose: true,
    smoothScroll: true,
    stagePadding: 6,
    nextBtnText: 'Next',
    prevBtnText: 'Back',
    doneBtnText: 'Got it',
    steps,
    onPopoverRender: (popover) => {
      // One-click skip, always visible.
      const skip = document.createElement('button');
      skip.type = 'button';
      skip.textContent = 'Skip tour';
      skip.className = 'driver-popover-skip-btn';
      skip.style.cssText = 'margin-right:8px;padding:3px 7px;font:12px sans-serif;border:1px solid #ccc;border-radius:3px;background:#fff;color:#2d2d2d;cursor:pointer;';
      skip.addEventListener('click', () => tour.destroy());
      popover.footerButtons.prepend(skip);
    },
  });
  tour.drive();
  return tour;
};
