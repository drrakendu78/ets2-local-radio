// =====================================================
// ETS2 Local Radio - Tauri Bridge
// Connects the web frontend to Tauri backend commands
// =====================================================

(function() {
    'use strict';

    // Check if running in Tauri
    const isTauri = window.__TAURI__ !== undefined;

    if (!isTauri) {
        console.log('Not running in Tauri, using HTTP fallback');
        return;
    }

    console.log('Tauri bridge initialized');

    const { invoke } = window.__TAURI__.core;

    // Store for telemetry polling
    let telemetryInterval = null;
    let welcomeSkipped = localStorage.getItem('welcomeSkipped') === 'true';

    // =========================================================================
    // Welcome/Onboarding Screen
    // =========================================================================

    // Check plugin status and show welcome screen if needed
    async function checkAndShowWelcome() {
        try {
            const status = await invoke('plugin_get_status');
            const anyPluginInstalled = status.ets2.plugin_installed || status.ats.plugin_installed;
            const anyGameFound = status.ets2.path || status.ats.path;

            // Update welcome screen plugin status
            updateWelcomePluginStatus(status);

            // Show welcome if no plugin installed and not skipped
            if (!anyPluginInstalled && !welcomeSkipped) {
                showWelcomeScreen();
            } else {
                hideWelcomeScreen();
            }
        } catch (error) {
            console.error('Error checking plugin status:', error);
            // If error (not in Tauri), hide welcome
            hideWelcomeScreen();
        }
    }

    function showWelcomeScreen() {
        document.body.classList.add('show-welcome');
        const welcomeScreen = document.getElementById('welcomeScreen');
        if (welcomeScreen) {
            welcomeScreen.style.display = 'block';
        }
    }

    function hideWelcomeScreen() {
        document.body.classList.remove('show-welcome');
        const welcomeScreen = document.getElementById('welcomeScreen');
        if (welcomeScreen) {
            welcomeScreen.style.display = 'none';
        }
    }

    // Update welcome screen plugin cards
    function updateWelcomePluginStatus(status) {
        // ETS2
        const ets2Status = document.getElementById('welcome-ets2-status');
        const ets2Btn = document.getElementById('welcome-ets2-btn');
        if (ets2Status && ets2Btn) {
            if (status.ets2.path) {
                if (status.ets2.plugin_installed) {
                    ets2Status.innerHTML = '<i class="fa-solid fa-check-circle"></i> Plugin installed';
                    ets2Status.className = 'welcome-plugin-status installed';
                    ets2Btn.innerHTML = '<i class="fa-solid fa-check"></i> Installed';
                    ets2Btn.disabled = true;
                    ets2Btn.classList.add('btn-outlined');
                    ets2Btn.classList.remove('btn-filled');
                } else {
                    ets2Status.textContent = 'Game found - Click to install';
                    ets2Status.className = 'welcome-plugin-status';
                    ets2Btn.innerHTML = '<i class="fa-solid fa-download"></i> Install';
                    ets2Btn.disabled = false;
                }
            } else {
                ets2Status.textContent = 'Game not found';
                ets2Status.className = 'welcome-plugin-status not-found';
                ets2Btn.innerHTML = '<i class="fa-solid fa-download"></i> Install';
                ets2Btn.disabled = true;
            }
        }

        // ATS
        const atsStatus = document.getElementById('welcome-ats-status');
        const atsBtn = document.getElementById('welcome-ats-btn');
        if (atsStatus && atsBtn) {
            if (status.ats.path) {
                if (status.ats.plugin_installed) {
                    atsStatus.innerHTML = '<i class="fa-solid fa-check-circle"></i> Plugin installed';
                    atsStatus.className = 'welcome-plugin-status installed';
                    atsBtn.innerHTML = '<i class="fa-solid fa-check"></i> Installed';
                    atsBtn.disabled = true;
                    atsBtn.classList.add('btn-outlined');
                    atsBtn.classList.remove('btn-filled');
                } else {
                    atsStatus.textContent = 'Game found - Click to install';
                    atsStatus.className = 'welcome-plugin-status';
                    atsBtn.innerHTML = '<i class="fa-solid fa-download"></i> Install';
                    atsBtn.disabled = false;
                }
            } else {
                atsStatus.textContent = 'Game not found';
                atsStatus.className = 'welcome-plugin-status not-found';
                atsBtn.innerHTML = '<i class="fa-solid fa-download"></i> Install';
                atsBtn.disabled = true;
            }
        }

        // Check if any plugin is now installed -> auto-hide welcome
        if (status.ets2.plugin_installed || status.ats.plugin_installed) {
            setTimeout(() => {
                hideWelcomeScreen();
                // Show success message
                const snackbar = document.getElementById('snackbar');
                if (snackbar) {
                    snackbar.innerHTML = '<i class="fa-solid fa-rocket" style="color: var(--md-sys-color-primary);"></i> You\'re all set! Launch the game to start listening';
                    snackbar.classList.add('show');
                    setTimeout(() => snackbar.classList.remove('show'), 4000);
                }
            }, 1500);
        }
    }

    // Skip welcome screen
    window.skipWelcome = function() {
        welcomeSkipped = true;
        localStorage.setItem('welcomeSkipped', 'true');
        hideWelcomeScreen();
    };

    // Check welcome status on DOM ready
    document.addEventListener('DOMContentLoaded', async function() {
        checkAndShowWelcome();
        // Initialize settings in welcome screen too
        loadKeyboardSettings();
        loadControllerSettings();
        detectGamepads();

        // Load saved language from localStorage and sync with backend
        const savedLang = localStorage.getItem('language');
        if (savedLang) {
            if (typeof g_language !== 'undefined') {
                g_language = savedLang;
            }
            // Sync to backend
            try {
                await invoke('language_set', { lang: savedLang });
            } catch (error) {
                console.error('Error syncing language to backend:', error);
            }
        }

        // Set current language in welcome screen dropdown
        const welcomeLangSelect = document.getElementById('welcome-language-select');
        if (welcomeLangSelect && typeof g_language !== 'undefined') {
            welcomeLangSelect.value = g_language;
        }
    });

    // Start telemetry polling when Tauri is ready
    function startTelemetryPolling() {
        if (telemetryInterval) {
            clearInterval(telemetryInterval);
        }

        telemetryInterval = setInterval(async () => {
            try {
                const data = await invoke('telemetry_get');
                if (typeof refresh === 'function') {
                    refresh(data);
                }
            } catch (error) {
                console.error('Error getting telemetry:', error);
            }
        }, 1000);
    }

    // Override refreshFavourites to use Tauri
    const originalRefreshFavourites = window.refreshFavourites;
    window.refreshFavourites = async function(callback) {
        try {
            const data = await invoke('favourites_get_all');
            g_favourites = data;
            if (typeof callback === 'function') {
                callback();
            }
        } catch (error) {
            console.error('Error getting favourites:', error);
            // Fallback to original if available
            if (originalRefreshFavourites) {
                originalRefreshFavourites(callback);
            }
        }
    };

    // Override setFavouriteStation to use Tauri
    const originalSetFavouriteStation = window.setFavouriteStation;
    window.setFavouriteStation = async function(country, name) {
        if (typeof controlRemote !== 'undefined' && controlRemote) {
            // Remote control - use original behavior
            if (originalSetFavouriteStation) {
                originalSetFavouriteStation.call(this, country, name);
            }
            return;
        }

        try {
            await invoke('favourites_set', { country, name });

            // Show snackbar notification
            const snackbar = document.getElementById('snackbar');
            if (snackbar && typeof country_properties !== 'undefined' && country_properties[country]) {
                snackbar.innerHTML = '<i class="fa-solid fa-heart" style="color: #f65454;"></i> ' +
                    country_properties[country].name + ' - ' + name;
                snackbar.classList.add('show');
                setTimeout(() => {
                    snackbar.classList.remove('show');
                }, 3000);
            }

            // Refresh
            refreshFavourites(function() {
                if (typeof refreshStations === 'function') {
                    refreshStations();
                }
            });
        } catch (error) {
            console.error('Error setting favourite:', error);
        }
    };

    // Override the initialise function to start Tauri polling
    window.initialise = function() {
        console.log('Tauri: Starting initialization');

        // Setup audio elements
        $(document).ready(function() {
            const switchStation = document.getElementById("switchStation");
            const whitenoise = document.getElementById("whitenoise");

            if (switchStation) switchStation.volume = 0;
            if (whitenoise) {
                whitenoise.volume = 0;
                whitenoise.play().catch(() => {});
            }

            if (typeof g_skinConfig !== 'undefined' && g_skinConfig["transition-whitenoise"] === false) {
                if (switchStation) switchStation.src = "about:blank";
            }
        });

        // Load settings from localStorage
        if (localStorage.getItem("volume") == null) {
            localStorage.setItem("volume", 1);
        }
        if (localStorage.getItem("theme") == null) {
            localStorage.setItem("theme", "false");
        }

        g_volume = parseFloat(localStorage.getItem("volume"));
        g_darkThm = (localStorage.getItem("theme") === "true");

        if (typeof g_skinConfig !== 'undefined') {
            g_whitenoise = g_skinConfig.whitenoise;
        }

        $("#volumeControl").val(g_volume * 100);

        if (g_darkThm) {
            $('body').addClass('dark');
        }

        // Load language and favourites
        if (typeof refreshLanguage === 'function') {
            refreshLanguage();
        }
        refreshFavourites();

        // Start Tauri telemetry polling
        startTelemetryPolling();

        // Setup volume control
        $('#volumeControl').on("change mousemove", function() {
            if (typeof updateVolume === 'function') {
                updateVolume();
            }
        });

        // Setup player error handling
        $("#player").on("error", function(e) {
            if ($("#player").attr("src") !== "about:blank") {
                console.log('Player error:', e);
            }
        });

        // Check for remote connection via hash
        $(document).ready(function() {
            setTimeout(function() {
                const hash = parseInt(location.hash.substring(1));
                if (hash >= 10000 && hash <= 99999 && typeof connect === 'function') {
                    connect(hash);
                }
            }, 5000);
        });

        console.log('Tauri: Initialization complete');
    };

    // Get commands (for keyboard shortcuts from desktop)
    async function getCommands() {
        try {
            const data = await invoke('commands_get');
            if (typeof processCommand === 'function') {
                processCommand(data);
            }
        } catch (error) {
            // Silently fail - commands are optional
        }
    }

    // Poll commands periodically (for desktop keyboard shortcuts)
    setInterval(getCommands, 2000);

    // Clean up on page unload
    window.addEventListener('beforeunload', function() {
        if (telemetryInterval) {
            clearInterval(telemetryInterval);
        }
    });

    // =========================================================================
    // Settings & Plugin Installation
    // =========================================================================

    // Open settings modal
    window.openSettings = async function() {
        document.getElementById('settingsModal').classList.add('show');
        await refreshPluginStatus();
        loadKeyboardSettings();
        loadControllerSettings();
        detectGamepads();

        // Set current language in dropdown
        const langSelect = document.getElementById('language-select');
        if (langSelect && typeof g_language !== 'undefined') {
            langSelect.value = g_language;
        }
    };

    // Refresh plugin installation status (settings modal + welcome screen)
    async function refreshPluginStatus() {
        try {
            const status = await invoke('plugin_get_status');

            // Update settings modal
            const ets2Status = document.getElementById('ets2-status');
            const ets2Btn = document.getElementById('ets2-install-btn');
            if (ets2Status && ets2Btn) {
                if (status.ets2.path) {
                    if (status.ets2.plugin_installed) {
                        ets2Status.innerHTML = '<span style="color: var(--md-sys-color-primary);"><i class="fa-solid fa-check-circle"></i> Plugin installed</span>';
                        ets2Btn.innerHTML = '<i class="fa-solid fa-check"></i> Installed';
                        ets2Btn.disabled = true;
                        ets2Btn.classList.add('btn-filled');
                        ets2Btn.classList.remove('btn-outlined');
                    } else {
                        ets2Status.textContent = 'Game found - Plugin not installed';
                        ets2Btn.innerHTML = '<i class="fa-solid fa-download"></i> Install';
                        ets2Btn.disabled = false;
                        ets2Btn.classList.remove('btn-filled');
                        ets2Btn.classList.add('btn-outlined');
                    }
                } else {
                    ets2Status.textContent = 'Game not found';
                    ets2Btn.innerHTML = '<i class="fa-solid fa-download"></i> Install';
                    ets2Btn.disabled = true;
                }
            }

            const atsStatus = document.getElementById('ats-status');
            const atsBtn = document.getElementById('ats-install-btn');
            if (atsStatus && atsBtn) {
                if (status.ats.path) {
                    if (status.ats.plugin_installed) {
                        atsStatus.innerHTML = '<span style="color: var(--md-sys-color-primary);"><i class="fa-solid fa-check-circle"></i> Plugin installed</span>';
                        atsBtn.innerHTML = '<i class="fa-solid fa-check"></i> Installed';
                        atsBtn.disabled = true;
                        atsBtn.classList.add('btn-filled');
                        atsBtn.classList.remove('btn-outlined');
                    } else {
                        atsStatus.textContent = 'Game found - Plugin not installed';
                        atsBtn.innerHTML = '<i class="fa-solid fa-download"></i> Install';
                        atsBtn.disabled = false;
                        atsBtn.classList.remove('btn-filled');
                        atsBtn.classList.add('btn-outlined');
                    }
                } else {
                    atsStatus.textContent = 'Game not found';
                    atsBtn.innerHTML = '<i class="fa-solid fa-download"></i> Install';
                    atsBtn.disabled = true;
                }
            }

            // Also update welcome screen
            updateWelcomePluginStatus(status);
        } catch (error) {
            console.error('Error getting plugin status:', error);
        }
    }

    // Install plugin for a game
    window.installPlugin = async function(game) {
        // Get all buttons for this game (settings modal + welcome screen)
        const settingsBtn = document.getElementById(game + '-install-btn');
        const welcomeBtn = document.getElementById('welcome-' + game + '-btn');
        const buttons = [settingsBtn, welcomeBtn].filter(b => b);

        // Store original text and show loading on all buttons
        const originalTexts = buttons.map(btn => btn.innerHTML);
        buttons.forEach(btn => {
            btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Installing...';
            btn.disabled = true;
        });

        try {
            await invoke('plugin_install', { game });

            // Show success notification
            const snackbar = document.getElementById('snackbar');
            if (snackbar) {
                const gameName = game === 'ets2' ? 'Euro Truck Simulator 2' : 'American Truck Simulator';
                snackbar.innerHTML = '<i class="fa-solid fa-check-circle" style="color: var(--md-sys-color-primary);"></i> Plugin installed for ' + gameName;
                snackbar.classList.add('show');
                setTimeout(() => snackbar.classList.remove('show'), 3000);
            }

            await refreshPluginStatus();
        } catch (error) {
            console.error('Error installing plugin:', error);

            // Restore buttons
            buttons.forEach((btn, i) => {
                btn.innerHTML = originalTexts[i];
                btn.disabled = false;
            });

            // Show error notification
            const snackbar = document.getElementById('snackbar');
            if (snackbar) {
                snackbar.innerHTML = '<i class="fa-solid fa-exclamation-triangle" style="color: var(--md-sys-color-error);"></i> Error: ' + error;
                snackbar.classList.add('show');
                setTimeout(() => snackbar.classList.remove('show'), 5000);
            }
        }
    };

    // Uninstall plugins
    window.uninstallPlugins = async function() {
        if (!confirm('Are you sure you want to uninstall the plugins from both games?')) {
            return;
        }

        try {
            await invoke('plugin_uninstall', { game: 'ets2' }).catch(() => {});
            await invoke('plugin_uninstall', { game: 'ats' }).catch(() => {});

            const snackbar = document.getElementById('snackbar');
            if (snackbar) {
                snackbar.innerHTML = '<i class="fa-solid fa-check-circle"></i> Plugins uninstalled';
                snackbar.classList.add('show');
                setTimeout(() => snackbar.classList.remove('show'), 3000);
            }

            await refreshPluginStatus();
        } catch (error) {
            console.error('Error uninstalling plugins:', error);
        }
    };

    // =========================================================================
    // Keyboard Shortcuts
    // =========================================================================

    const defaultKeyBindings = {
        next: 'Next',
        prev: 'PageUp',
        stop: 'End',
        volup: 'OemPlus',
        voldown: 'OemMinus',
        fav: 'Pause'
    };

    let keyBindings = { ...defaultKeyBindings };
    let capturingKey = null;

    function loadKeyboardSettings() {
        const saved = localStorage.getItem('keyBindings');
        if (saved) {
            try {
                keyBindings = { ...defaultKeyBindings, ...JSON.parse(saved) };
            } catch (e) {
                keyBindings = { ...defaultKeyBindings };
            }
        }

        // Update UI (both settings modal and welcome screen)
        for (const [action, key] of Object.entries(keyBindings)) {
            // Settings modal
            const input = document.getElementById('key-' + action);
            if (input) {
                input.value = key;
                input.dataset.key = key;
            }
            // Welcome screen
            const welcomeInput = document.getElementById('welcome-key-' + action);
            if (welcomeInput) {
                welcomeInput.value = key;
                welcomeInput.dataset.key = key;
            }
        }
    }

    window.captureKey = function(input, action) {
        // Remove capturing class from all inputs
        document.querySelectorAll('.settings-key-input').forEach(el => {
            el.classList.remove('capturing');
        });

        input.classList.add('capturing');
        input.value = '...';
        capturingKey = { input, action };

        // Listen for key press
        const handler = function(e) {
            e.preventDefault();
            e.stopPropagation();

            const keyName = e.key === ' ' ? 'Space' : e.key;
            input.value = keyName;
            input.dataset.key = keyName;
            input.classList.remove('capturing');
            keyBindings[action] = keyName;
            capturingKey = null;

            document.removeEventListener('keydown', handler);
        };

        document.addEventListener('keydown', handler);
    };

    // =========================================================================
    // Controller/Gamepad Support
    // =========================================================================

    const defaultButtonBindings = {
        next: '',
        prev: '',
        stop: '',
        volup: '',
        voldown: '',
        fav: ''
    };

    let buttonBindings = { ...defaultButtonBindings };
    let selectedGamepadIndex = null;
    let capturingButton = null;
    let gamepadPollingInterval = null;

    function loadControllerSettings() {
        const saved = localStorage.getItem('buttonBindings');
        if (saved) {
            try {
                buttonBindings = { ...defaultButtonBindings, ...JSON.parse(saved) };
            } catch (e) {
                buttonBindings = { ...defaultButtonBindings };
            }
        }

        // Update UI (both settings modal and welcome screen)
        for (const [action, btn] of Object.entries(buttonBindings)) {
            // Settings modal
            const input = document.getElementById('btn-' + action);
            if (input) {
                input.value = btn ? 'Button ' + btn : '-';
                input.dataset.btn = btn;
            }
            // Welcome screen
            const welcomeInput = document.getElementById('welcome-btn-' + action);
            if (welcomeInput) {
                welcomeInput.value = btn ? 'Button ' + btn : '-';
                welcomeInput.dataset.btn = btn;
            }
        }

        // Load selected gamepad
        const savedGamepad = localStorage.getItem('selectedGamepad');
        if (savedGamepad) {
            selectedGamepadIndex = parseInt(savedGamepad);
        }
    }

    function detectGamepads() {
        // Get both selects (settings modal and welcome screen)
        const selects = [
            document.getElementById('gamepad-select'),
            document.getElementById('welcome-gamepad-select')
        ].filter(s => s);

        if (selects.length === 0) return;

        const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];

        selects.forEach(select => {
            // Clear existing options except first
            select.innerHTML = '<option value="">No controller detected</option>';

            for (let i = 0; i < gamepads.length; i++) {
                const gp = gamepads[i];
                if (gp) {
                    const option = document.createElement('option');
                    option.value = i;
                    option.textContent = gp.id;
                    select.appendChild(option);

                    if (selectedGamepadIndex === i) {
                        select.value = i;
                    }
                }
            }
        });
    }

    window.selectGamepad = function(index) {
        selectedGamepadIndex = index ? parseInt(index) : null;
        localStorage.setItem('selectedGamepad', index || '');
    };

    window.captureButton = function(input, action) {
        if (selectedGamepadIndex === null) {
            alert('Please select a controller first');
            return;
        }

        // Remove capturing class from all inputs
        document.querySelectorAll('.settings-key-input').forEach(el => {
            el.classList.remove('capturing');
        });

        input.classList.add('capturing');
        input.value = '...';
        capturingButton = { input, action };

        // Start polling for button press
        if (gamepadPollingInterval) {
            clearInterval(gamepadPollingInterval);
        }

        const pressedButtons = new Set();
        const gamepads = navigator.getGamepads();
        const gp = gamepads[selectedGamepadIndex];
        if (gp) {
            gp.buttons.forEach((btn, i) => {
                if (btn.pressed) pressedButtons.add(i);
            });
        }

        gamepadPollingInterval = setInterval(() => {
            const gamepads = navigator.getGamepads();
            const gp = gamepads[selectedGamepadIndex];
            if (!gp) return;

            for (let i = 0; i < gp.buttons.length; i++) {
                if (gp.buttons[i].pressed && !pressedButtons.has(i)) {
                    // Button newly pressed
                    input.value = 'Button ' + i;
                    input.dataset.btn = i.toString();
                    input.classList.remove('capturing');
                    buttonBindings[action] = i.toString();
                    capturingButton = null;

                    clearInterval(gamepadPollingInterval);
                    gamepadPollingInterval = null;
                    return;
                }
            }
        }, 50);

        // Cancel after 5 seconds
        setTimeout(() => {
            if (capturingButton && capturingButton.input === input) {
                input.classList.remove('capturing');
                input.value = buttonBindings[action] ? 'Button ' + buttonBindings[action] : '-';
                capturingButton = null;

                if (gamepadPollingInterval) {
                    clearInterval(gamepadPollingInterval);
                    gamepadPollingInterval = null;
                }
            }
        }, 5000);
    };

    // Gamepad input handling (runs continuously)
    let lastButtonStates = {};
    function pollGamepadInput() {
        if (selectedGamepadIndex === null) return;

        const gamepads = navigator.getGamepads();
        const gp = gamepads[selectedGamepadIndex];
        if (!gp) return;

        for (const [action, btnIndex] of Object.entries(buttonBindings)) {
            if (!btnIndex) continue;
            const idx = parseInt(btnIndex);
            const pressed = gp.buttons[idx]?.pressed;
            const wasPressed = lastButtonStates[idx];

            if (pressed && !wasPressed) {
                // Button just pressed
                executeAction(action);
            }
            lastButtonStates[idx] = pressed;
        }
    }

    function executeAction(action) {
        switch (action) {
            case 'next':
                if (typeof nextStation === 'function') nextStation(1);
                break;
            case 'prev':
                if (typeof nextStation === 'function') nextStation(-1);
                break;
            case 'stop':
                if (typeof togglePlay === 'function') togglePlay();
                break;
            case 'volup':
                if (typeof volumeChange === 'function') {
                    volumeChange(5);
                    if (typeof updateVolume === 'function') updateVolume();
                }
                break;
            case 'voldown':
                if (typeof volumeChange === 'function') {
                    volumeChange(-5);
                    if (typeof updateVolume === 'function') updateVolume();
                }
                break;
            case 'fav':
                if (typeof setCurrentAsFavourite === 'function') setCurrentAsFavourite();
                break;
        }
    }

    // Start gamepad polling
    setInterval(pollGamepadInput, 100);

    // Listen for gamepad connections
    window.addEventListener('gamepadconnected', () => {
        detectGamepads();
    });

    window.addEventListener('gamepaddisconnected', () => {
        detectGamepads();
    });

    // =========================================================================
    // Language
    // =========================================================================

    window.changeLanguage = async function(lang) {
        if (typeof g_language !== 'undefined') {
            g_language = lang;
            localStorage.setItem('language', lang);

            // Update backend so processCommand doesn't reset it
            try {
                await invoke('language_set', { lang });
            } catch (error) {
                console.error('Error setting language in backend:', error);
            }

            if (typeof refreshLanguage === 'function') {
                refreshLanguage();
            }
        }
    };

    // =========================================================================
    // Save Settings
    // =========================================================================

    window.saveSettings = function() {
        // Save keyboard bindings
        localStorage.setItem('keyBindings', JSON.stringify(keyBindings));

        // Save controller bindings
        localStorage.setItem('buttonBindings', JSON.stringify(buttonBindings));

        // Close modal
        document.getElementById('settingsModal').classList.remove('show');

        // Show notification
        const snackbar = document.getElementById('snackbar');
        if (snackbar) {
            snackbar.innerHTML = '<i class="fa-solid fa-check-circle" style="color: var(--md-sys-color-primary);"></i> Settings saved';
            snackbar.classList.add('show');
            setTimeout(() => snackbar.classList.remove('show'), 3000);
        }
    };

    // Save settings from welcome screen and continue
    window.saveSettingsAndContinue = function() {
        // Save keyboard bindings
        localStorage.setItem('keyBindings', JSON.stringify(keyBindings));

        // Save controller bindings
        localStorage.setItem('buttonBindings', JSON.stringify(buttonBindings));

        // Mark welcome as completed (not just skipped)
        welcomeSkipped = true;
        localStorage.setItem('welcomeSkipped', 'true');

        // Hide welcome screen
        hideWelcomeScreen();

        // Show notification
        const snackbar = document.getElementById('snackbar');
        if (snackbar) {
            snackbar.innerHTML = '<i class="fa-solid fa-check-circle" style="color: var(--md-sys-color-primary);"></i> Settings saved! Launch the game to start listening.';
            snackbar.classList.add('show');
            setTimeout(() => snackbar.classList.remove('show'), 4000);
        }
    };

    // Global keyboard shortcut handler
    document.addEventListener('keydown', function(e) {
        // Don't handle if in input field or capturing
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
        if (capturingKey) return;

        const key = e.key === ' ' ? 'Space' : e.key;

        for (const [action, boundKey] of Object.entries(keyBindings)) {
            if (key === boundKey) {
                e.preventDefault();
                executeAction(action);
                break;
            }
        }
    });

    console.log('Tauri bridge loaded successfully');
})();
