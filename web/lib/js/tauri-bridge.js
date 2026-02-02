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
        const navbar = document.querySelector('.navbar');
        const footer = document.querySelector('.footer');
        if (welcomeScreen) {
            welcomeScreen.style.display = 'block';
        }
        if (navbar) {
            navbar.style.display = 'none';
        }
        if (footer) {
            footer.style.display = 'none';
        }
    }

    function hideWelcomeScreen() {
        document.body.classList.remove('show-welcome');
        const welcomeScreen = document.getElementById('welcomeScreen');
        const navbar = document.querySelector('.navbar');
        const footer = document.querySelector('.footer');
        if (welcomeScreen) {
            welcomeScreen.style.display = 'none';
        }
        if (navbar) {
            navbar.style.display = 'flex';
        }
        if (footer) {
            footer.style.display = 'block';
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

    // Skip welcome screen (temporary - will show again on next restart)
    window.skipWelcome = function() {
        welcomeSkipped = true;
        // Don't save to localStorage - welcome will show again on restart
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

            // Reset welcome screen state
            localStorage.removeItem('welcomeSkipped');
            welcomeSkipped = false;

            // Show welcome screen immediately
            showWelcomeScreen();

            // Show notification
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
    // Global Keyboard Shortcuts (work even when game is in foreground)
    // =========================================================================

    const defaultKeyBindings = {
        next: 'F11',
        prev: 'F10',
        stop: 'End',
        volup: 'NumpadAdd',
        voldown: 'NumpadSubtract',
        fav: 'Pause'
    };

    // Migration map for old key names to new defaults
    const keyMigration = {
        'Next': 'F11',
        'PageDown': 'F11',
        'PageUp': 'F10',
        'OemPlus': 'NumpadAdd',
        'OemMinus': 'NumpadSubtract',
        '+': 'NumpadAdd',
        '-': 'NumpadSubtract'
    };

    let keyBindings = { ...defaultKeyBindings };
    let capturingKey = null;
    let globalShortcutsRegistered = false;

    // Get the global shortcut plugin API
    function getGlobalShortcut() {
        if (window.__TAURI__?.globalShortcut) {
            return window.__TAURI__.globalShortcut;
        }
        return null;
    }

    // Debounce map to prevent double-triggering
    const lastShortcutTime = {};
    const DEBOUNCE_MS = 300;

    // Register all global shortcuts
    async function registerGlobalShortcuts() {
        const gs = getGlobalShortcut();
        if (!gs) {
            console.log('Global shortcut plugin not available');
            return;
        }

        // First unregister any existing shortcuts
        await unregisterGlobalShortcuts();

        try {
            for (const [action, key] of Object.entries(keyBindings)) {
                if (!key) continue;

                try {
                    await gs.register(key, (shortcut) => {
                        // Debounce to prevent double-triggering
                        const now = Date.now();
                        if (lastShortcutTime[action] && (now - lastShortcutTime[action]) < DEBOUNCE_MS) {
                            return; // Skip, too soon
                        }
                        lastShortcutTime[action] = now;

                        console.log('Global shortcut triggered:', action);
                        executeAction(action);
                    });
                    console.log(`Registered global shortcut: ${key} -> ${action}`);
                } catch (e) {
                    console.warn(`Failed to register shortcut ${key}:`, e);
                }
            }
            globalShortcutsRegistered = true;
            console.log('Global shortcuts registered successfully');
        } catch (error) {
            console.error('Error registering global shortcuts:', error);
        }
    }

    // Unregister all global shortcuts
    async function unregisterGlobalShortcuts() {
        const gs = getGlobalShortcut();
        if (!gs) return;

        try {
            await gs.unregisterAll();
            globalShortcutsRegistered = false;
        } catch (error) {
            console.error('Error unregistering global shortcuts:', error);
        }
    }

    function loadKeyboardSettings() {
        const saved = localStorage.getItem('keyBindings');
        if (saved) {
            try {
                const parsed = JSON.parse(saved);
                // Migrate old key names to new ones
                for (const [action, key] of Object.entries(parsed)) {
                    if (keyMigration[key]) {
                        parsed[action] = keyMigration[key];
                    }
                }
                keyBindings = { ...defaultKeyBindings, ...parsed };
                // Save migrated values
                localStorage.setItem('keyBindings', JSON.stringify(keyBindings));
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

        // Register global shortcuts after loading settings
        registerGlobalShortcuts();
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

            // Convert key to format expected by global shortcut plugin
            let keyName = e.code; // Use e.code for more consistent key names

            // Handle special keys
            if (e.key === ' ') keyName = 'Space';
            else if (e.key === '+' || e.code === 'NumpadAdd') keyName = 'NumpadAdd';
            else if (e.key === '-' || e.code === 'NumpadSubtract') keyName = 'NumpadSubtract';
            else if (e.key === '*' || e.code === 'NumpadMultiply') keyName = 'NumpadMultiply';
            else if (e.key === '/' || e.code === 'NumpadDivide') keyName = 'NumpadDivide';
            else if (e.code.startsWith('Key')) keyName = e.code.replace('Key', ''); // KeyA -> A
            else if (e.code.startsWith('Digit')) keyName = e.code.replace('Digit', ''); // Digit1 -> 1
            else keyName = e.key; // F1, F2, etc.

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

    window.saveSettings = async function() {
        // Save keyboard bindings
        localStorage.setItem('keyBindings', JSON.stringify(keyBindings));

        // Save controller bindings
        localStorage.setItem('buttonBindings', JSON.stringify(buttonBindings));

        // Re-register global shortcuts with new bindings
        await registerGlobalShortcuts();

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
    window.saveSettingsAndContinue = async function() {
        // Save keyboard bindings
        localStorage.setItem('keyBindings', JSON.stringify(keyBindings));

        // Save controller bindings
        localStorage.setItem('buttonBindings', JSON.stringify(buttonBindings));

        // Re-register global shortcuts with new bindings
        await registerGlobalShortcuts();

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

    // Local keyboard shortcut handler (fallback when window is focused)
    // This is complementary to global shortcuts - handles when in app but global fails
    document.addEventListener('keydown', function(e) {
        // Don't handle if in input field or capturing
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
        if (capturingKey) return;

        // Use e.code for consistency with global shortcuts
        let keyCode = e.code;
        if (e.key === ' ') keyCode = 'Space';
        else if (e.code.startsWith('Key')) keyCode = e.code.replace('Key', '');
        else if (e.code.startsWith('Digit')) keyCode = e.code.replace('Digit', '');
        else keyCode = e.key;

        for (const [action, boundKey] of Object.entries(keyBindings)) {
            if (keyCode === boundKey || e.key === boundKey || e.code === boundKey) {
                e.preventDefault();
                executeAction(action);
                break;
            }
        }
    });

    // =========================================================================
    // Remote Control Functions
    // =========================================================================

    window.toggleRemoteControl = async function() {
        const toggle = document.getElementById('remoteControlToggle');
        const qrContainer = document.getElementById('qrCodeContainer');
        const qrImage = document.getElementById('qrCodeImage');
        const remoteUrlEl = document.getElementById('remoteUrl');

        if (!toggle) return;

        const enabled = toggle.checked;

        if (enabled) {
            try {
                console.log('Enabling remote control...');
                const qrDataUrl = await invoke('remote_enable');
                if (qrDataUrl && qrImage) {
                    qrImage.src = qrDataUrl;
                }

                // Get and display the URL
                try {
                    const url = await invoke('remote_get_url');
                    if (remoteUrlEl && url) {
                        remoteUrlEl.textContent = url;
                    }
                } catch (e) {
                    console.log('Could not get remote URL:', e);
                }

                if (qrContainer) {
                    qrContainer.style.display = 'block';
                }
                showSnackbar('Remote control enabled');
            } catch (error) {
                console.error('Failed to enable remote control:', error);
                toggle.checked = false;
                showSnackbar('Failed to enable remote control');
            }
        } else {
            try {
                console.log('Disabling remote control...');
                await invoke('remote_disable');
                if (qrContainer) {
                    qrContainer.style.display = 'none';
                }
                if (remoteUrlEl) {
                    remoteUrlEl.textContent = '';
                }
                showSnackbar('Remote control disabled');
            } catch (error) {
                console.error('Failed to disable remote control:', error);
            }
        }
    };

    // Update remote control state when radio state changes
    window.updateRemoteState = async function() {
        try {
            const status = await invoke('remote_status');
            if (status) {
                const player = document.getElementById('player');
                const stationNameEl = document.querySelector('.current-station') || document.querySelector('.station-name');

                // Get station name from various possible sources
                let stationName = '-';
                if (stationNameEl) {
                    stationName = stationNameEl.textContent || '-';
                } else if (typeof g_current_name !== 'undefined' && g_current_name) {
                    stationName = g_current_name;
                }

                // Get country name
                let countryName = '-';
                if (typeof g_current_country !== 'undefined' && g_current_country) {
                    if (typeof country_properties !== 'undefined' && country_properties[g_current_country]) {
                        countryName = country_properties[g_current_country].name || g_current_country;
                    } else {
                        countryName = g_current_country;
                    }
                }

                // Send current radio state to remote server
                await invoke('remote_update_state', {
                    stationId: (typeof g_current_url !== 'undefined' ? g_current_url : '') || '',
                    stationName: stationName,
                    country: countryName,
                    volume: (typeof g_volume !== 'undefined' ? g_volume : 1) || 1,
                    playing: player ? !player.paused : false,
                    muted: player ? (player.muted || false) : false
                });
            }
        } catch (error) {
            // Silently fail if remote not enabled
        }
    };

    // Note: Remote state update is now integrated into the unified setStation hook below
    // (in the overlay section) which waits for main.js to load

    // Hook into play/pause to update remote state
    document.addEventListener('DOMContentLoaded', function() {
        const player = document.getElementById('player');
        if (player) {
            player.addEventListener('play', () => window.updateRemoteState());
            player.addEventListener('pause', () => window.updateRemoteState());
            player.addEventListener('volumechange', () => window.updateRemoteState());
        }
    });

    // Poll for remote commands
    let remoteEnabled = false;
    setInterval(async function() {
        try {
            const status = await invoke('remote_status');
            remoteEnabled = status;
            if (!status) return;

            // Update state periodically
            await window.updateRemoteState();

            // Check for commands from mobile
            let cmd = await invoke('remote_get_command_rx');
            while (cmd) {
                console.log('Remote command received:', cmd);

                // Handle volume:value format
                if (cmd.startsWith('volume:')) {
                    const value = parseFloat(cmd.split(':')[1]);
                    if (!isNaN(value)) {
                        g_volume = value;
                        localStorage.setItem('volume', value);
                        $('#volumeControl').val(value * 100);
                        if (typeof updateVolume === 'function') {
                            updateVolume();
                        }
                    }
                } else {
                    switch (cmd) {
                        case 'next':
                            if (typeof nextStation === 'function') {
                                nextStation(1);
                            }
                            break;
                        case 'prev':
                            if (typeof nextStation === 'function') {
                                nextStation(-1);
                            }
                            break;
                        case 'play':
                            document.getElementById('player').play();
                            break;
                        case 'pause':
                            document.getElementById('player').pause();
                            break;
                        case 'togglePlay':
                            if (typeof togglePlay === 'function') {
                                togglePlay();
                            }
                            break;
                        case 'mute':
                            document.getElementById('player').muted = true;
                            break;
                        case 'unmute':
                            document.getElementById('player').muted = false;
                            break;
                        case 'favourite':
                            if (typeof setCurrentAsFavourite === 'function') {
                                setCurrentAsFavourite();
                            }
                            break;
                    }
                }

                // Check for more commands
                cmd = await invoke('remote_get_command_rx');
            }
        } catch (error) {
            // Silently fail
        }
    }, 250); // Poll more frequently

    // Helper function for snackbar notifications
    function showSnackbar(message) {
        const snackbar = document.getElementById('snackbar');
        if (snackbar) {
            snackbar.textContent = message;
            snackbar.classList.add('show');
            setTimeout(() => {
                snackbar.classList.remove('show');
            }, 3000);
        }
    }

    // =========================================================================
    // In-Game Overlay Functions (always enabled like original)
    // =========================================================================

    let overlayEnabled = true; // Always enabled like the original
    let overlayAttached = false;
    let overlayBridgeStarted = false;

    // Auto-start overlay bridge on load
    document.addEventListener('DOMContentLoaded', async function() {
        // Update toggle if it exists
        const toggle = document.getElementById('overlayToggle');
        if (toggle) {
            toggle.checked = true;
        }

        // Start overlay bridge automatically
        console.log('Auto-starting overlay bridge...');
        try {
            await startOverlayBridge();
            overlayBridgeStarted = true;
        } catch (e) {
            console.warn('Could not auto-start overlay bridge:', e);
        }
    });

    // Start the overlay bridge process
    window.startOverlayBridge = async function() {
        try {
            const result = await invoke('overlay_start');
            console.log('Overlay bridge started:', result);
            return true;
        } catch (error) {
            console.error('Failed to start overlay bridge:', error);
            showSnackbar('Failed to start overlay: ' + error);
            return false;
        }
    };

    // Stop the overlay bridge process
    window.stopOverlayBridge = async function() {
        try {
            await invoke('overlay_stop');
            overlayAttached = false;
            console.log('Overlay bridge stopped');
            return true;
        } catch (error) {
            console.error('Failed to stop overlay bridge:', error);
            return false;
        }
    };

    // Attach overlay to the game
    window.attachOverlay = async function(game) {
        try {
            // Ensure bridge is running
            if (!overlayBridgeStarted) {
                console.log('Starting overlay bridge first...');
                const started = await startOverlayBridge();
                if (!started) {
                    console.error('Failed to start overlay bridge');
                    return false;
                }
                overlayBridgeStarted = true;
                // Wait for bridge to fully start
                await new Promise(resolve => setTimeout(resolve, 2000));
            }

            // Attach to game
            console.log('Sending attach command for game:', game || 'ets2');
            const result = await invoke('overlay_attach', { game: game || 'ets2' });
            console.log('Attach result:', result);

            // Parse JSON response
            let parsed = null;
            try {
                parsed = typeof result === 'string' ? JSON.parse(result) : result;
            } catch (e) {
                console.log('Could not parse attach result as JSON:', result);
            }

            // Check if attach was successful
            if (parsed && parsed.success === true) {
                overlayAttached = true;
                console.log('Overlay attached successfully to', parsed.game);
                return true;
            } else if (parsed && parsed.success === false) {
                console.log('Attach failed - game process not found');
                overlayAttached = false;
                return false;
            } else if (result && typeof result === 'string') {
                // Fallback for string responses
                if (result.includes('"success":true') || result.includes('Attached')) {
                    overlayAttached = true;
                    return true;
                }
            }

            console.log('Unknown attach result:', result);
            overlayAttached = false;
            return false;
        } catch (error) {
            console.error('Failed to attach overlay:', error);
            overlayAttached = false;
            return false;
        }
    };

    // Detach overlay from game
    window.detachOverlay = async function() {
        try {
            await invoke('overlay_detach');
            overlayAttached = false;
            console.log('Overlay detached');
            return true;
        } catch (error) {
            console.error('Failed to detach overlay:', error);
            return false;
        }
    };

    // Show station overlay in game
    window.showOverlay = async function(stationName, signal, logoPath, nowPlayingText, rtl) {
        if (!overlayEnabled || !overlayAttached) return;

        try {
            await invoke('overlay_show', {
                station: stationName || '',
                signal: String(signal || '5'),
                logo: logoPath || null,
                nowPlaying: nowPlayingText || null,
                rtl: rtl || false
            });
            console.log('Overlay shown:', stationName);
        } catch (error) {
            console.error('Failed to show overlay:', error);
        }
    };

    // Hide the overlay
    window.hideOverlay = async function() {
        try {
            await invoke('overlay_hide');
        } catch (error) {
            console.error('Failed to hide overlay:', error);
        }
    };

    // Toggle overlay on/off
    window.toggleOverlay = async function() {
        const toggle = document.getElementById('overlayToggle');
        if (!toggle) {
            console.error('Overlay toggle element not found!');
            return;
        }

        overlayEnabled = toggle.checked;
        localStorage.setItem('overlayEnabled', overlayEnabled);
        console.log('Overlay toggled:', overlayEnabled);

        if (overlayEnabled) {
            // Start the overlay bridge first
            console.log('Starting overlay bridge...');
            const bridgeStarted = await startOverlayBridge();
            console.log('Bridge started:', bridgeStarted);

            if (!bridgeStarted) {
                toggle.checked = false;
                overlayEnabled = false;
                localStorage.setItem('overlayEnabled', 'false');
                return;
            }

            // Try to attach to game
            const game = typeof g_game !== 'undefined' ? g_game : 'ets2';
            console.log('Attaching to game:', game);
            const success = await attachOverlay(game);
            console.log('Attach result:', success, 'overlayAttached:', overlayAttached);

            if (success) {
                showSnackbar('In-game overlay enabled - will show when changing stations');
            } else {
                // Keep overlay enabled but inform user
                showSnackbar('Overlay enabled - will activate when game starts');
            }
        } else {
            await detachOverlay();
            await stopOverlayBridge();
            showSnackbar('In-game overlay disabled');
        }
    };

    // Get overlay status
    window.getOverlayStatus = async function() {
        try {
            return await invoke('overlay_status');
        } catch (error) {
            return false;
        }
    };

    // Hook into setRadioStation to show overlay when station changes
    // We need to wait for main.js to load and define setRadioStation
    let overlayHookInstalled = false;

    function installOverlayHook() {
        if (overlayHookInstalled) return true;

        const originalSetRadioStation = window.setRadioStation;
        if (!originalSetRadioStation) {
            return false; // Not ready yet
        }

        window.setRadioStation = function(url, country, volume) {
            const result = originalSetRadioStation.call(this, url, country, volume);

            // Find the station info from global stations array
            let stationName = '';
            let stationLogo = '';
            let signalLevel = '5';

            console.log('setRadioStation args: url=', url, 'country=', country, 'g_stations length=', typeof g_stations !== 'undefined' ? g_stations.length : 0);

            if (typeof g_stations !== 'undefined' && Array.isArray(g_stations)) {
                // Debug: show first matching station by url only
                const matchByUrl = g_stations.find(s => s.url === url);
                const matchByCountry = g_stations.filter(s => s.country === country).slice(0, 3);
                console.log('Match by URL:', matchByUrl ? JSON.stringify(matchByUrl) : 'not found');
                console.log('Stations in country (first 3):', matchByCountry.map(s => ({name: s.name, Name: s.Name, url: s.url})));
                // Show first station structure
                if (g_stations.length > 0) {
                    console.log('First station structure:', Object.keys(g_stations[0]));
                }

                for (let i = 0; i < g_stations.length; i++) {
                    if (g_stations[i].url === url) {  // Match by URL only, country might differ
                        // Try both lowercase and capitalized property names
                        stationName = g_stations[i].name || g_stations[i].Name || '';
                        stationLogo = g_stations[i].logo || g_stations[i].Logo || '';
                        // Calculate signal from volume/whitenoise
                        if (typeof volume !== 'undefined' && volume !== null) {
                            const reception = Math.pow(parseFloat(volume), 2) - 0.15;
                            if (reception < 0.05) signalLevel = '5';
                            else if (reception < 0.20) signalLevel = '4';
                            else if (reception < 0.35) signalLevel = '3';
                            else if (reception < 0.50) signalLevel = '2';
                            else if (reception < 0.75) signalLevel = '1';
                            else signalLevel = '0';
                        }
                        console.log('Station found:', stationName, 'logo:', stationLogo);
                        break;
                    }
                }
            }

            // Fallback: search in global 'stations' object which has names
            if (!stationName && typeof stations !== 'undefined' && country && stations[country]) {
                const countryStations = stations[country];
                for (let i = 0; i < countryStations.length; i++) {
                    if (countryStations[i].url === url) {
                        stationName = countryStations[i].name || '';
                        stationLogo = countryStations[i].logo || '';
                        console.log('Found in stations[country]:', stationName, 'logo:', stationLogo);
                        break;
                    }
                }
            }

            // Fallback: use g_current_name if available
            if (!stationName && typeof g_current_name !== 'undefined' && g_current_name) {
                stationName = g_current_name;
                console.log('Using g_current_name as fallback:', stationName);
            }

            console.log('setRadioStation called:', stationName, '| overlayEnabled:', overlayEnabled, '| overlayAttached:', overlayAttached);

            // Update remote control state after station change
            setTimeout(() => window.updateRemoteState(), 100);

            // Show overlay if enabled and we have a station name
            if (overlayEnabled && overlayAttached && stationName) {
                // Get localized "Now playing" text
                let nowPlayingText = 'Now playing:';
                if (typeof g_translation !== 'undefined' && g_translation.web && g_translation.web['now-playing']) {
                    nowPlayingText = g_translation.web['now-playing'];
                }

                // Determine RTL (for Hebrew, Arabic, etc.)
                let isRtl = false;
                if (typeof g_language !== 'undefined') {
                    isRtl = g_language.startsWith('he') || g_language.startsWith('ar');
                }

                console.log('Showing overlay for:', stationName);
                showOverlay(stationName, signalLevel, stationLogo, nowPlayingText, isRtl);
            } else {
                console.log('Overlay not shown - enabled:', overlayEnabled, 'attached:', overlayAttached, 'station:', stationName);
            }

            return result;
        };

        overlayHookInstalled = true;
        console.log('Overlay hook installed successfully on setRadioStation');
        return true;
    }

    // Try to install hook now (in case main.js loaded first)
    installOverlayHook();

    // Also try after DOM is loaded
    document.addEventListener('DOMContentLoaded', function() {
        if (!overlayHookInstalled) {
            installOverlayHook();
        }
    });

    // Keep trying every 500ms until hook is installed (max 10 seconds)
    let hookRetries = 0;
    const hookInterval = setInterval(function() {
        if (installOverlayHook() || hookRetries >= 20) {
            clearInterval(hookInterval);
            if (!overlayHookInstalled) {
                console.warn('Could not install overlay hook after 10 seconds');
            }
        }
        hookRetries++;
    }, 500);

    // Auto-attach overlay when game is detected
    let lastGameRunning = null;
    let attachRetryCount = 0;
    const MAX_ATTACH_RETRIES = 3;

    async function tryAttachOverlay() {
        if (!overlayEnabled || overlayAttached) return;

        const game = typeof g_game !== 'undefined' ? g_game : 'ets2';
        console.log('Attempting to attach overlay to', game, '(attempt', attachRetryCount + 1, ')');

        try {
            const success = await attachOverlay(game);
            if (success) {
                console.log('Overlay attached successfully!');
                attachRetryCount = 0;
            } else {
                attachRetryCount++;
                console.log('Attach failed, will retry...');
            }
        } catch (e) {
            attachRetryCount++;
            console.log('Attach error:', e);
        }
    }

    setInterval(async function() {
        if (!overlayEnabled) return;

        // Only try to attach if not already attached
        if (!overlayAttached && attachRetryCount < MAX_ATTACH_RETRIES) {
            try {
                const telemetry = await invoke('telemetry_get');
                const pos = telemetry?.truck_values?.positioning?.head_position;
                const gameRunning = pos && (pos.x !== 0 || pos.y !== 0 || pos.z !== 0);

                if (gameRunning) {
                    // Game is running - try to attach
                    await tryAttachOverlay();
                }
            } catch (error) {
                // Silently fail
            }
        }
        // Don't auto-detach - keep overlay attached once successful
    }, 3000); // Check every 3 seconds

    // Also try to attach immediately after bridge starts
    setTimeout(async function() {
        if (overlayBridgeStarted && !overlayAttached) {
            console.log('Initial overlay attach attempt...');
            await tryAttachOverlay();
        }
    }, 3000);

    console.log('Tauri bridge loaded successfully');
})();
