class ViewTimeout {
  constructor() {
    this.timer = null;
    this.checkInterval = null;
    this.boundReset = this.resetTimer.bind(this);

    // State
    this.activePanelUrl = null; // The dashboard we are currently "serving"
    this.currentUser = null;
    this.homeView = "home";
    this.timeoutDuration = 15000;
    this.viewSpecificRedirects = {};
    this.isEnabled = false;
    
    // Reset triggers
    this.resetOnMove = false;
    this.resetOnClick = true;
    
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
    // This dynamically grabs the CURRENT lovelace panel
    return this.main?.querySelector("ha-panel-lovelace");
  }

  log(msg, error = false) {
    const style = "color: orange; font-weight: bold; background: black; padding: 2px;";
    if (error) {
      console.error(`%c VIEWTIMEOUT %c ERROR: ${msg}`, style, "color: red;");
    } else {
      console.info(`%c VIEWTIMEOUT %c ${msg}`, style, "color: gray;");
    }
  }

  init() {
    // We check every second. This interval runs forever, across all dashboards.
    this.checkInterval = setInterval(() => this.masterLoop(), 1000);
    this.log("Service started. Waiting for config...");
  }

  // This loop runs every second to check:
  // 1. Did we change dashboards?
  // 2. If yes, load new config.
  // 3. If no, run the timeout logic.
  masterLoop() {
    if (new URLSearchParams(window.location.search).has("disable_timeout")) return;

    const currentPanelUrl = this.ha?.hass?.panelUrl;

    // SCENARIO 1: Dashboard Change Detected
    if (currentPanelUrl !== this.activePanelUrl) {
      this.handleDashboardChange(currentPanelUrl);
      return; 
    }

    // SCENARIO 2: We are on the active dashboard, and it is enabled.
    if (this.isEnabled) {
      this.checkTimeoutLogic();
    }
  }

  handleDashboardChange(newPanelUrl) {
    // 1. Stop any running timers from the previous dashboard
    this.stopTimer();
    
    // 2. Try to find config for this new dashboard
    // It might take a moment for the new ha-panel-lovelace to load its config
    const llConfig = this.lovelace?.lovelace?.config;

    if (llConfig && llConfig.view_timeout) {
      // Config FOUND. Activate for this dashboard.
      this.activePanelUrl = newPanelUrl;
      this.parseConfig(llConfig);
    } else {
      // Config NOT FOUND. 
      // We update the activePanelUrl to prevent constantly retrying this logic every second
      // But we mark isEnabled as false so we stay dormant.
      // (Unless llConfig is completely null, meaning it hasn't loaded yet, then we wait and retry next loop)
      if (this.lovelace?.lovelace) {
         this.activePanelUrl = newPanelUrl;
         this.isEnabled = false;
         // Silent mode: We are on a dashboard that doesn't use ViewTimeout.
      }
    }
  }

  parseConfig(llConfig) {
    const config = llConfig.view_timeout || {};
    
    // Global Toggle Check
    if (config.timeout === false) {
        this.isEnabled = false;
        return;
    }

    // User Whitelist Check
    this.currentUser = this.ha?.hass?.user?.name?.toLowerCase();
    if (config.users && Array.isArray(config.users)) {
        const allowedUsers = config.users.map(u => u.toLowerCase());
        if (!allowedUsers.includes(this.currentUser)) {
            this.isEnabled = false;
            return;
        }
    }

    // Load Settings
    this.timeoutDuration = config.duration ?? 15000;
    this.homeView = config.default ?? "home";
    this.resetOnMove = config.reset?.mouse_move ?? false;
    this.resetOnClick = config.reset?.mouse_click ?? true;
    this.viewSpecificRedirects = config.views || {};

    // Activate
    this.isEnabled = true;
    this.log(`Active on /${this.activePanelUrl} (Timeout: ${this.timeoutDuration}ms)`);
  }

  getCurrentView() {
    return window.location.pathname.split("/").pop();
  }

  checkTimeoutLogic() {
    // Safety: If we drifted somehow, stop.
    if (this.ha?.hass?.panelUrl !== this.activePanelUrl) return;

    const currentView = this.getCurrentView();

    // 1. Is this the default home view?
    if (currentView === this.homeView) {
      this.stopTimer();
      return;
    }

    // 2. Is this view explicitly disabled?
    const specificTarget = this.viewSpecificRedirects[currentView];
    if (specificTarget === false) {
      this.stopTimer();
      return;
    }

    // 3. If no default home and no specific target, do nothing.
    if (!this.homeView && !specificTarget) {
        this.stopTimer();
        return;
    }

    // Run timer if not already running
    if (!this.timer) {
      this.startTimer();
    }
  }

  startTimer() {
    // Re-bind listeners (idempotent, safe to call multiple times due to boundReset)
    if (this.resetOnMove) window.addEventListener("mousemove", this.boundReset);
    if (this.resetOnClick) window.addEventListener("click", this.boundReset);
    this.resetTimer();
  }

  stopTimer() {
    window.removeEventListener("mousemove", this.boundReset);
    window.removeEventListener("click", this.boundReset);
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  resetTimer() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.executeRedirect(), this.timeoutDuration);
  }

  executeRedirect() {
    // Double check we are still on the right dashboard
    if (this.ha?.hass?.panelUrl !== this.activePanelUrl) {
        this.stopTimer();
        return;
    }

    this.stopTimer();

    try {
        const activeEl = this.main?.activeElement || document.activeElement;
        activeEl?.blur();
    } catch (e) {}

    const currentView = this.getCurrentView();
    const target = this.viewSpecificRedirects[currentView] ?? this.homeView;

    if (target) {
        this.navigate(`/${this.activePanelUrl}/${target}`);
    }
  }

  navigate(path) {
    window.history.pushState(null, "", path);
    window.dispatchEvent(new CustomEvent("location-changed", { 
        bubbles: true, 
        composed: true 
    }));
  }
}

Promise.resolve(customElements.whenDefined("hui-view")).then(() => {
  if (!window.ViewTimeout) {
    window.ViewTimeout = new ViewTimeout();
  }
});
