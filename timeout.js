class ViewTimeout {
  constructor() {
    this.ha = document.querySelector("home-assistant");
    this.main = this.ha.shadowRoot.querySelector("home-assistant-main").shadowRoot;

    this.llAttempts = 0;

    this.user;
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
    if (this.queryString("disable_timeout") || !lovelace) return;
    this.getConfig(lovelace);
  }

  getConfig(lovelace) {
    this.llAttempts++;

    try {
      const llConfig = lovelace.lovelace.config;
      const config = llConfig.view_timeout || {};
      this.processUsers(lovelace, config);
      this.processReset(lovelace, config);
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

  processUsers(lovelace, config) {
    try {
      this.user = {
        logged: this.ha.hass.user?.name.toLowerCase() || '',
        list: []
      };
      const users = config.users || [];
      users.forEach(user => this.user.list.push(user.toLowerCase()));
    } catch (e) {
      console.log("User data not found, continuing ignoring users.");
      console.log(e);
    }
  }

  processReset(lovelace, config) {
    this.reset = {
      mouse_move: (typeof config.reset?.mouse_move === 'boolean') ? config.reset.mouse_move : false,
      mouse_click: (typeof config.reset?.mouse_click === 'boolean') ? config.reset.mouse_click : true,
      in_lovelace: (typeof config.reset?.in_lovelace === 'boolean') ? config.reset.in_lovelace : false
    };
  }

  processConfig(lovelace, config) {
    if (!config.timeout) return;
    if (this.user.list.length && this.user.list.indexOf(this.user.logged) < 0) return;

    this.homeView = config.default || "home";
    this.defaultPanelUrl = this.ha.hass.panelUrl;

    this.timeoutTime = config.duration || 30000;
    setTimeout(() => this.urlCheckerStart(), 50);
  }

  // Convert to array.
  array(x) {
    return Array.isArray(x) ? x : [x];
  }  

  queryString(keywords) {
    return this.array(keywords).some((x) => window.location.search.includes(x));
  }

  resetEvent() {
    clearTimeout(this.ViewTimeout.viewTimeout);
    this.ViewTimeout.viewTimeout = setTimeout(() => this.ViewTimeout.timeoutReturn(), this.ViewTimeout.timeoutTime);
  }

  setViewTimeout() {
    if (this.reset.mouse_move) {
      window.addEventListener("mousemove", this.resetEvent);
    }

    if (this.reset.mouse_click) {
      window.addEventListener("click", this.resetEvent);
    }

    this.viewTimeout = setTimeout(() => this.timeoutReturn(), this.timeoutTime);
  }

  cancelEverything() {
    window.removeEventListener("mousemove", this.resetEvent);
    window.removeEventListener("click", this.resetEvent);
    clearTimeout(this.viewTimeout);
    //null the timeout
    this.viewTimeout = false;
  }

  timeoutReturn() {
    this.cancelEverything();

    //Remove focus from the former active tab to clear the style
    try {
      var activeTab = this.main.querySelector('ha-drawer > partial-panel-resolver > ha-panel-lovelace').shadowRoot.querySelector('hui-root').shadowRoot.activeElement;
      if (activeTab != null) activeTab.blur();
    } catch (e) {
      console.log("Failed to blur active tab:" + e);
    }

    //switch tabs
    window.history.pushState("", "", "/" + this.defaultPanelUrl + "/" + this.homeView);
    window.cardTools.fireEvent("location-changed", {}, document.querySelector("home-assistant"));
  }

  urlCheckerStart() {
   this.urlInterval = setInterval(() => this.urlChecker(), 1000);
  }

  urlGetView() {
    return window.location.pathname.split("/").pop();
  }

  isDefaultPanel() {
    return window.location.pathname === "/" + this.defaultPanelUrl || window.location.pathname.startsWith("/" + this.defaultPanelUrl + "/");
  }

  urlChecker() {
    const in_lovelace = !this.reset.in_lovelace || this.isDefaultPanel();

    if (in_lovelace && this.homeView != this.urlGetView()) {
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

// Initial Run
Promise.resolve(customElements.whenDefined("hui-view")).then(() => {
  window.ViewTimeout = new ViewTimeout();
});
