const VIEWTIMEOUT_VERSION = "1.3.0";
const DEFAULT_DURATION = 15000;

// Events that count as user activity. Listeners are registered on window in
// the capture phase, so cards that stop propagation can't swallow them.
// "pointerdown"/"touchstart" are needed on touch screens: HA's tap handler
// cancels touchend, so a tap never produces a "click" event there.
// "blur" fires when focus moves into an iframe (e.g. a webpage card), whose
// own events never reach this window.
const CLICK_EVENTS = ["pointerdown", "touchstart", "mousedown", "click", "keydown", "wheel", "blur"];
const MOVE_EVENTS = ["mousemove", "pointermove"];
const LISTENER_OPTIONS = { capture: true, passive: true };

class ViewTimeout {
  constructor() {
    this.timer = null;
    this.checkInterval = null;
    this.boundReset = this.onActivity.bind(this);
    this.listeningTo = [];
    this.redirecting = false;

    // State
    this.activePanelUrl = null; // The dashboard we are currently "serving"
    this.activeConfig = null; // The lovelace config object the settings were read from
    this.currentView = null;
    this.currentTarget = null;
    this.homeView = "home";
    this.timeoutDuration = DEFAULT_DURATION;
    this.viewSpecificRedirects = {};
    this.isEnabled = false;
    this.debugParam = new URLSearchParams(window.location.search).has("debug_timeout");
    this.debug = this.debugParam;

    // Behaviour
    this.resetOnMove = false;
    this.resetOnClick = true;
    this.closeDialogs = true;
    this.respectVisibility = false;

    // Start the global watcher
    this.init();
  }

  get ha() {
    return document.querySelector("home-assistant");
  }

  get main() {
    return this.ha?.shadowRoot?.querySelector("home-assistant-main")?.shadowRoot;
  }

  get lovelace() {
    // Only return the lovelace panel of the CURRENT dashboard. While switching
    // dashboards the previous panel can still be in the DOM, and reading its
    // config would apply the wrong dashboard's settings.
    const panelUrl = this.ha?.hass?.panelUrl;
    const panels = this.main?.querySelectorAll("ha-panel-lovelace") ?? [];
    for (const panel of panels) {
      if (!panel.panel || panel.panel.url_path === panelUrl) return panel;
    }
    return null;
  }

  log(msg, error = false) {
    const style = "color: orange; font-weight: bold; background: black; padding: 2px;";
    if (error) {
      console.error(`%c VIEWTIMEOUT %c ERROR: ${msg}`, style, "color: red;");
    } else {
      console.info(`%c VIEWTIMEOUT %c ${msg}`, style, "color: gray;");
    }
  }

  debugLog(msg) {
    if (this.debug) this.log(`[debug] ${msg}`);
  }

  // Snapshot of the current state, for troubleshooting from the browser console:
  //   window.ViewTimeout.status()
  status() {
    return {
      version: VIEWTIMEOUT_VERSION,
      enabled: this.isEnabled,
      dashboard: this.activePanelUrl,
      user: this.ha?.hass?.user?.name,
      currentView: this.getCurrentView(),
      defaultView: this.homeView,
      redirectTarget: this.currentTarget,
      duration: this.timeoutDuration,
      timerRunning: Boolean(this.timer),
      views: this.viewSpecificRedirects,
      reset: { mouse_move: this.resetOnMove, mouse_click: this.resetOnClick },
      close_dialogs: this.closeDialogs,
      respect_visibility: this.respectVisibility,
    };
  }

  init() {
    // We check every second. This interval runs forever, across all dashboards.
    this.checkInterval = setInterval(() => this.masterLoop(), 1000);
    this.log(`v${VIEWTIMEOUT_VERSION} started. Waiting for config...`);
  }

  // This loop runs every second to check:
  // 1. Did we change dashboards, or was the dashboard config loaded/saved?
  // 2. If yes, load the config.
  // 3. Run the timeout logic.
  masterLoop() {
    if (new URLSearchParams(window.location.search).has("disable_timeout")) {
      this.stopTimer();
      return;
    }
    if (this.redirecting) return;

    const currentPanelUrl = this.ha?.hass?.panelUrl;
    const lovelace = this.lovelace?.lovelace;
    const llConfig = lovelace?.config;

    if (currentPanelUrl !== this.activePanelUrl || llConfig !== this.activeConfig) {
      this.loadConfig(currentPanelUrl, llConfig);
    }

    if (!this.isEnabled) return;

    // Never navigate away while the dashboard is being edited
    if (lovelace.editMode) {
      this.stopTimer();
      return;
    }

    this.checkTimeoutLogic();
  }

  loadConfig(panelUrl, llConfig) {
    this.stopTimer();
    this.isEnabled = false;
    this.activePanelUrl = panelUrl;
    this.activeConfig = llConfig;
    this.currentView = null;
    this.debug = this.debugParam;

    // Not a dashboard, or its config hasn't loaded yet. Once it loads the
    // config object changes and we end up here again.
    if (!llConfig) return;

    const config = llConfig.view_timeout;
    if (!config) {
      this.debugLog(`No view_timeout config on /${panelUrl}`);
      return;
    }

    this.debug = this.debugParam || config.debug === true;

    // Global Toggle Check
    if (config.timeout === false) {
      this.log(`Disabled on /${panelUrl} (timeout: false)`);
      return;
    }

    // User Whitelist Check (by user name or user id)
    if (Array.isArray(config.users) && config.users.length) {
      const user = this.ha?.hass?.user;
      if (!user) {
        // User not loaded yet, try again on the next loop
        this.activeConfig = null;
        return;
      }
      const allowedUsers = config.users.map((u) => String(u).toLowerCase());
      if (!allowedUsers.includes(user.name?.toLowerCase()) && !allowedUsers.includes(user.id)) {
        this.log(`Not active on /${panelUrl}: user "${user.name}" is not in the users list`);
        return;
      }
    }

    // Load Settings
    let duration = Number(config.duration ?? DEFAULT_DURATION);
    if (!Number.isFinite(duration) || duration <= 0) {
      this.log(`Invalid duration "${config.duration}", using ${DEFAULT_DURATION}`, true);
      duration = DEFAULT_DURATION;
    } else if (duration < 1000) {
      this.log(`duration is ${duration}ms. The duration is in milliseconds, did you mean ${duration * 1000}?`, true);
    }
    this.timeoutDuration = duration;

    // `default: null` (or false) means only the views listed under `views` redirect
    this.homeView = config.default === undefined ? "home" : this.viewName(config.default);
    this.viewSpecificRedirects = {};
    if (config.views && typeof config.views === "object") {
      for (const [view, target] of Object.entries(config.views)) {
        this.viewSpecificRedirects[view] = target === false ? false : this.viewName(target);
      }
    }

    this.resetOnMove = config.reset?.mouse_move ?? false;
    this.resetOnClick = config.reset?.mouse_click ?? true;
    this.closeDialogs = config.close_dialogs ?? true;
    this.respectVisibility = config.respect_visibility ?? false;

    this.validateViews(panelUrl, llConfig);

    // Activate
    this.isEnabled = true;
    this.log(
      `Active on /${panelUrl} (Timeout: ${this.timeoutDuration}ms, default view: ${this.homeView ?? "none"})`
    );
  }

  viewName(value) {
    return value === null || value === undefined || value === false ? null : String(value);
  }

  // Finds a view by path, or by index for views without a path (same as HA does)
  findView(viewId, llConfig = this.activeConfig) {
    const views = llConfig?.views;
    if (!Array.isArray(views)) return undefined;
    const byPath = views.find((v) => v.path === viewId);
    if (byPath) return byPath;
    return /^\d+$/.test(viewId) ? views[Number(viewId)] : undefined;
  }

  // Warn about view names that don't exist in this dashboard. A common mistake
  // is using the dashboard name or the view title instead of the view's path.
  validateViews(panelUrl, llConfig) {
    if (!Array.isArray(llConfig.views)) return;
    const names = [
      this.homeView,
      ...Object.keys(this.viewSpecificRedirects),
      ...Object.values(this.viewSpecificRedirects),
    ].filter((v) => typeof v === "string");
    const missing = [...new Set(names)].filter((v) => !this.findView(v, llConfig));
    if (missing.length) {
      const available = llConfig.views.map((v, i) => v.path ?? String(i)).join(", ");
      this.log(
        `View(s) not found on /${panelUrl}: ${missing.join(", ")}. ` +
          `Use the view's "path" (or its index when it has no path). Available: ${available}`,
        true
      );
    }
  }

  isViewVisible(viewId) {
    const view = this.findView(viewId);
    if (!view || view.visible === undefined || view.visible === true) return true;
    if (Array.isArray(view.visible)) {
      const userId = this.ha?.hass?.user?.id;
      return view.visible.some((v) => v.user === userId);
    }
    return false;
  }

  getCurrentView() {
    return window.location.pathname.split("/").filter(Boolean).pop();
  }

  // Where the given view should go on timeout: a view name, false (explicitly
  // disabled) or null (nothing to do, e.g. we are already home).
  resolveTarget(view) {
    let target = this.viewSpecificRedirects[view];
    if (target === undefined) {
      target = view === this.homeView ? null : this.homeView;
    }
    if (target === view) target = null;
    if (target && this.respectVisibility && !this.isViewVisible(target)) {
      this.debugLog(`Target view "${target}" is not visible to this user, not redirecting`);
      target = null;
    }
    return target;
  }

  isDialogOpen() {
    return Boolean(window.history.state?.dialog);
  }

  checkTimeoutLogic() {
    // Safety: If we drifted somehow, stop.
    if (this.ha?.hass?.panelUrl !== this.activePanelUrl) return;

    // Changing views counts as activity: taps on tiles that navigate don't
    // always produce events we can see.
    const view = this.getCurrentView();
    if (view !== this.currentView) {
      this.stopTimer();
      this.currentView = view;
      this.currentTarget = this.resolveTarget(view);
      this.debugLog(
        `View "${view}": ` +
          (this.currentTarget === false
            ? "timeout disabled for this view"
            : this.currentTarget
              ? `will go to "${this.currentTarget}" after ${this.timeoutDuration}ms`
              : "no redirect")
      );
    }

    // Also run the timer on the default view while a dialog (e.g. more-info) is open,
    // so the dialog gets closed.
    const closeDialogOnly = this.closeDialogs && view === this.homeView && this.isDialogOpen();
    const shouldRun = this.currentTarget !== false && (Boolean(this.currentTarget) || closeDialogOnly);

    if (!shouldRun) {
      this.stopTimer();
      return;
    }

    // Run timer if not already running
    if (!this.timer) {
      this.startTimer();
    }
  }

  startTimer() {
    const events = [...(this.resetOnClick ? CLICK_EVENTS : []), ...(this.resetOnMove ? MOVE_EVENTS : [])];
    for (const event of events) window.addEventListener(event, this.boundReset, LISTENER_OPTIONS);
    this.listeningTo = events;
    this.resetTimer();
    this.debugLog(`Timer started (${this.timeoutDuration}ms)`);
  }

  stopTimer() {
    for (const event of this.listeningTo) window.removeEventListener(event, this.boundReset, LISTENER_OPTIONS);
    this.listeningTo = [];
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  onActivity(ev) {
    this.debugLog(`Timer reset (${ev.type})`);
    this.resetTimer();
  }

  resetTimer() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.executeRedirect(), this.timeoutDuration);
  }

  async executeRedirect() {
    this.stopTimer();

    // Double check we are still on the right dashboard
    if (this.ha?.hass?.panelUrl !== this.activePanelUrl) return;

    const view = this.getCurrentView();
    const target = this.resolveTarget(view);

    this.redirecting = true;
    try {
      if (this.closeDialogs) await this.closeOpenDialogs();

      try {
        const activeEl = this.main?.activeElement || document.activeElement;
        activeEl?.blur();
      } catch (e) {}

      // Bail out if the user navigated somewhere else meanwhile
      if (target && this.getCurrentView() === view && this.ha?.hass?.panelUrl === this.activePanelUrl) {
        this.debugLog(`Timeout: going from "${view}" to "${target}"`);
        this.navigate(`/${this.activePanelUrl}/${target}`);
      }
    } finally {
      this.redirecting = false;
    }
  }

  // HA adds a history entry for every open dialog (more-info, etc.) and
  // closes the top dialog when that entry is popped, like the back button does.
  async closeOpenDialogs() {
    for (let i = 0; i < 10 && this.isDialogOpen(); i++) {
      this.debugLog(`Closing dialog "${window.history.state.dialog}"`);
      await new Promise((resolve) => {
        const done = () => {
          clearTimeout(fallback);
          window.removeEventListener("popstate", done);
          // Give HA a moment to close the dialog and update the history state
          setTimeout(resolve, 100);
        };
        const fallback = setTimeout(done, 1000);
        window.addEventListener("popstate", done);
        window.history.back();
      });
    }
  }

  // Navigate the same way Home Assistant's own navigate() does
  navigate(path) {
    const from = window.location.pathname + window.location.search;
    window.history.pushState({ from }, "", path);
    window.dispatchEvent(
      new CustomEvent("location-changed", {
        bubbles: true,
        composed: true,
        detail: { replace: false },
      })
    );
  }
}

Promise.resolve(customElements.whenDefined("hui-view")).then(() => {
  if (!window.ViewTimeout) {
    window.ViewTimeout = new ViewTimeout();
  }
});
