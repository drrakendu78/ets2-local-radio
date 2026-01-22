# ETS2 Local Radio - Tauri Edition Settings

This document describes all settings for ETS2 Local Radio Tauri Edition.

## Web Configuration

Can be found as `web/config.js`, follows JavaScript object syntax.

### radius
What the base radius (broadcasting range) for all cities is in meters.

### threshold
How much better the reception needs to be in a different country (ETS2)/city (ATS) to switch to that country/city. 0 switches immediately, 1 switches never.

### whitenoise
Whether to play static when a station is far away.

### transition-whitenoise
Whether to play static when changing stations.

### url-prefix
The URL prefix for loading station images.

### map
What map you're using. Based on a file in the cities directory.

### stations
What stations to use. Based on a file in the stations directory.

## Custom Stations

You can add custom stations by editing the `web/custom.js` file. See the file for examples and format.

---

*Based on the original settings documentation by [Koenvh1](https://github.com/Koenvh1)*
