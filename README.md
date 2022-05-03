# viewtimeout

![hacs_badge](https://img.shields.io/badge/HACS-Default-yellow.svg)

Returns to specified default view after activity timeout [Home Assistant](https://www.home-assistant.io/)




## Important Info

* If you need to disable the timeout feature temporarily add `?disable_timeout` to the end of your URL.
* Config is placed in the root of your Lovelace config: `view_timeout:`


  
## Config Options

| Config Option | Type | Default | Description |
|:---------------|:---------------|:---------------|:----------|
|`timeout:`| Boolean | true | enables/disables the timeout feature.
|`default:` | String | home | view to default back to after timeout.
|`duration:` | Number | 15000 | timeout in milliseconds


## Simple config example

```
view_timeout:
  timeout: true
  default: home
  duration: 15000
  
views:


```
## TODO

*User Exceptions 
*Per View settings (don't timeout, duration, default to different view or panel)


