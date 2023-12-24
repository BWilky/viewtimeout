class ViewTimeout {
  constructor() {
    this.ha = document.querySelector("home-assistant");
    this.main = this.ha.shadowRoot.querySelector("home-assistant-main").shadowRoot;

    this.llAttempts = 0;

    this.user;
    this.views;
    this.pause;
    this.reset;
    this.homeView;
    this.timeoutTime;
    this.urlInterval;
    this.viewTimeout;
    this.defaultPanelUrl;

    this.run();
  }

  run(lovelace = this.main.querySelector("ha-panel-lovelace")) {
    if (this.queryString("disable_timeout") || !lovelace) {
      return;
    }
    this.getConfig(lovelace);

    console.info("%c VIEWTIMEOUT %c v1.1.0 ", "color: orange; font-weight: bold; background: black", "color: white; font-weight: bold; background: dimgray");
  }

  // initialise tous les éléments
  getConfig(lovelace) {
    this.llAttempts++;

    try {
      const llConfig = lovelace.lovelace.config;
      const config = llConfig.view_timeout || {};

      this.processUsers(lovelace, config);
      this.processReset(lovelace, config);
      this.processViews(lovelace, config);
      this.processConfig(lovelace, config);
    } catch (e) {
      if (this.llAttempts < 200) {
        setTimeout(() => this.getConfig(lovelace), 50);
      } else {
        console.log("Lovelace config not found, continuing with default configuration.");
        console.log(e);
        this.processConfig(lovelace, {});
      }
    }
  }

  // returns the destination view based on the current view
  getTarget(name) {
    const target = this.views[this.urlGetView()];
    return (typeof target === 'string' || target === false) ? target : null;
  }

  // checks if the current user is authorized
  processUsers(lovelace, config) {
    try {
      this.user = {
        logged: this.ha.hass.user?.name.toLowerCase() || '',
        list: []
      };

      // adds lowercase usernames to the array
      const users = config.users || [];
      users.forEach(user => this.user.list.push(user.toLowerCase()));
    } catch (e) {
      console.log("User data not found, continuing ignoring users.");
      console.log(e);
    }
  }

  // checks the different reset settings
  processReset(lovelace, config) {
    this.reset = {
      mouse_move: (typeof config.reset?.mouse_move === 'boolean') ? config.reset.mouse_move : false,
      mouse_click: (typeof config.reset?.mouse_click === 'boolean') ? config.reset.mouse_click : true,
      in_lovelace: (typeof config.reset?.in_lovelace === 'boolean') ? config.reset.in_lovelace : false
    };
  }

  // checks the destination of the views
  processViews(lovelace, config) {
    this.views = (typeof config.views === 'object') ? config.views : [];
  }

  // 
  processConfig(lovelace, config) {
    if (!config.timeout || (this.user.list.length && this.user.list.indexOf(this.user.logged) < 0)) {
      return;
    }

    this.homeView = config.default;
    this.defaultPanelUrl = this.ha.hass.panelUrl;

    this.timeoutTime = config.duration || 30000;
    setTimeout(() => this.urlCheckerStart(), 50);
  }

  // convert to array.
  array(x) {
    return Array.isArray(x) ? x : [x];
  }  

  // checks if the keys are present in the query
  queryString(keywords) {
    return this.array(keywords).some((x) => window.location.search.includes(x));
  }

  // resets the countdown when an event is raised
  resetEvent() {
    clearTimeout(this.viewTimeout);
    this.viewTimeout = setTimeout(() => this.timeoutReturn(), this.timeoutTime);
  }

  // activates the countdown
  setViewTimeout() {
    if (this.reset.mouse_move) {
      window.addEventListener("mousemove", () => this.resetEvent());
    }

    if (this.reset.mouse_click) {
      window.addEventListener("click", () => this.resetEvent());
    }

    this.viewTimeout = setTimeout(() => this.timeoutReturn(), this.timeoutTime);
  }

  // deactivates the countdown
  cancelEverything() {
    window.removeEventListener("mousemove", this.resetEvent);
    window.removeEventListener("click", this.resetEvent);
    clearTimeout(this.viewTimeout);
    // null the timeout
    this.viewTimeout = false;
  }

  // redirects once the countdown is complete
  timeoutReturn() {
    this.cancelEverything();

    // remove focus from the former active tab to clear the style
    try {
      const activeTab = this.main.querySelector("ha-drawer > partial-panel-resolver > ha-panel-lovelace").shadowRoot.querySelector("hui-root").shadowRoot.activeElement;
      if (activeTab != null) {
        activeTab.blur();
      }
    } catch (e) {
      console.log("Failed to blur active tab: " + e);
    }

    // switch tabs
    const target = this.getTarget(this.urlGetView()) || "home";
    window.history.pushState("", "", "/" + this.defaultPanelUrl + "/" + target);
    window.cardTools.fireEvent("location-changed", {}, document.querySelector("home-assistant"));
  }

  urlCheckerStart() {
    this.urlInterval = setInterval(() => this.urlChecker(), 1000);
  }

  // returns the id of the current view
  urlGetView() {
    return window.location.pathname.split("/").pop();
  }

  // indicates if you are on the Lovelace dashboard
  isDefaultPanel() {
    return window.location.pathname === "/" + this.defaultPanelUrl || window.location.pathname.startsWith("/" + this.defaultPanelUrl + "/");
  }

  // activates or deactivates the countdown depending on the different settings
  urlChecker() {
    // if the current view is not the default view, or if this view has destination "false" (false disables redirection to the default)
    const isTargetedView = this.homeView === this.urlGetView() || this.getTarget(this.urlGetView()) === false;
    // if the variable "in_lovelace" is "false" (therefore the redirection works in any Home Assistant) or that we are in the lovelace dashboard
    const inLovelace = !this.reset.in_lovelace || this.isDefaultPanel();

    if (!isTargetedView && inLovelace) {
      if (!this.viewTimeout) {
        this.setViewTimeout();
      }
    } else {
      if (this.viewTimeout) {
        this.cancelEverything();
      }
    }
  }
}

// initial run
Promise.resolve(customElements.whenDefined("hui-view")).then(() => {
  window.ViewTimeout = new ViewTimeout();
});
