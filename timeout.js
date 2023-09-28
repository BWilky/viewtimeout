class ViewTimeout {
  constructor() {

    this.ha = document.querySelector("home-assistant");
    this.main = this.ha.shadowRoot.querySelector("home-assistant-main").shadowRoot;
    
    this.llAttempts = 0;
    
    this.viewTimeout;
    this.urlInterval;
    this.timeoutTime;
    this.homeView;
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

  processConfig(lovelace, config) {
    if(!config.timeout) return;
    
    this.homeView = config.default || "home";
    this.defaultPanelUrl = this.ha.hass.panelUrl;
    
    this.timeoutTime = config.duration || 30000;
    this.dashboard
    setTimeout(() => this.urlCheckerStart(), 50);
  }
  
  // Convert to array.
  array(x) {
    return Array.isArray(x) ? x : [x];
  }  
  
  queryString(keywords) {
    return this.array(keywords).some((x) => window.location.search.includes(x));
  }


  clickEvent() {
      clearTimeout(this.ViewTimeout.viewTimeout);
      this.ViewTimeout.viewTimeout = setTimeout(() => this.ViewTimeout.timeoutReturn(), this.ViewTimeout.timeoutTime);
  }

  setViewTimeout() {
   window.addEventListener("click", this.clickEvent );
   this.viewTimeout = setTimeout(() => this.timeoutReturn(), this.timeoutTime);
  }
  cancelEverything() {
    window.removeEventListener("click", this.clickEvent );
    clearTimeout(this.viewTimeout);
    //null the timeout
    this.viewTimeout = false;
  }

  timeoutReturn() {
    this.cancelEverything();

    //Remove focus from the former active tab to clear the style (by focussing the navbar parent element)
    var navbar = this.main.querySelector('ha-drawer > partial-panel-resolver > ha-panel-lovelace').shadowRoot.querySelector('hui-root').shadowRoot.querySelector('ha-tabs');
    navbar.focus();

    //switch tabs
    window.history.pushState("", "", '/'+this.defaultPanelUrl+'/'+this.homeView);
    window.cardTools.fireEvent("location-changed", {}, document.querySelector("home-assistant"));
  }
  
  urlCheckerStart() {
   this.urlInterval = setInterval(() => this.urlChecker(), 1000);
  }
  
  urlGetView() {
    const currentView = window.location.href.split("/").pop().split('?')[0];
    
    return currentView;
  }
  
  
  
  urlChecker() {
    if(this.homeView != this.urlGetView() && !this.viewTimeout) {
      this.setViewTimeout();

     }
  
    if(this.homeView == this.urlGetView() && this.viewTimeout) {
      this.cancelEverything();
    }
  }
}

// Initial Run
Promise.resolve(customElements.whenDefined("hui-view")).then(() => {
  window.ViewTimeout = new ViewTimeout();
});
