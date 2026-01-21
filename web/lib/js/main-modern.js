// =====================================================
// ETS2 Local Radio - Modern UI JavaScript Additions
// This file overrides refreshStations to use modern HTML
// =====================================================

// Store the original refreshStations function
var originalRefreshStations = refreshStations;

// Override refreshStations with modern card layout
refreshStations = function() {
    var content = "";
    var available_stations = [];

    for (var key in g_countries) {
        if (!g_countries.hasOwnProperty(key)) continue;
        if ($.isEmptyObject(stations[key])) continue;

        for (var j = 0; j < stations[key].length; j++) {
            var volume = g_countries[key]["whitenoise"];

            available_stations.push({
                url: stations[key][j]['url'],
                country: key,
                volume: volume
            });

            if (typeof stations[key][j]["relative_radius"] === "undefined" ||
                g_countries[key]["distance"] / stations[key][j]["relative_radius"] < g_skinConfig.radius) {

                var reception = calculateReception(g_countries[key]["whitenoise"]);
                var isSelected = (g_current_url == stations[key][j]['url'] && g_current_country == key);
                var isFavourite = g_favourites.hasOwnProperty(key) && g_favourites[key] == stations[key][j].name;

                content +=
                    '<div class="station-card ' + (isSelected ? "selected" : "") + '" ' +
                    'onclick="setRadioStation(\'' + stations[key][j]['url'] + '\', \'' + key + '\', \'' + volume + '\'); document.getElementById(\'player\').play();">' +

                    // Image container
                    '<div style="position: relative; background: var(--md-sys-color-surface-container); padding: var(--spacing-md);">' +
                    '<img class="station-card-image" src="' + getFullLogoUrl(stations[key][j]['logo']) + '" alt="' + stations[key][j]['name'] + '">' +

                    // Play overlay
                    '<div class="station-card-overlay">' +
                    '<div class="station-card-play-icon"><i class="fa-solid fa-play"></i></div>' +
                    '</div>' +

                    // Signal badge
                    '<div class="station-card-signal">' +
                    '<img src="lib/img/signal/' + reception + '.png" alt="Signal">' +
                    '</div>' +
                    '</div>' +

                    // Content
                    '<div class="station-card-content">' +
                    '<h3 class="station-card-title">' + stations[key][j]['name'] + '</h3>' +
                    '<div class="station-card-subtitle">' +
                    (typeof country_properties[key].name !== "undefined" ? country_properties[key].name : key.toUpperCase()) +
                    (typeof country_properties[key].code !== "undefined" ?
                        ' <img src="lib/flags/' + country_properties[key].code + '.svg" class="station-card-flag" alt="">' : '') +
                    '</div>' +

                    // Favourite button
                    (!isFavourite ?
                        '<button class="btn-text" style="margin-top: var(--spacing-sm); padding: var(--spacing-xs) var(--spacing-sm); font-size: 12px;" ' +
                        'onclick="event.stopPropagation(); setFavouriteStation(\'' + key + '\', \'' + stations[key][j]['name'] + '\');">' +
                        '<i class="fa-regular fa-heart"></i> ' +
                        ((typeof g_translation !== 'undefined' && typeof g_translation['web']['make-favourite'] !== 'undefined') ?
                            g_translation['web']['make-favourite'] : 'Favourite') +
                        '</button>' :
                        '<span style="display: inline-flex; align-items: center; gap: 4px; margin-top: var(--spacing-sm); font-size: 12px; color: var(--md-sys-color-primary);">' +
                        '<i class="fa-solid fa-heart"></i> Favourite</span>') +
                    '</div>' +
                    '</div>';
            }
        }
    }

    $("#stationsList").html(content);

    // Guard: Only update current station display if we have valid data
    if (g_current_country && stations[g_current_country] && stations[g_current_country].length > 0) {
        var index = stations[g_current_country].map(function (e) {
            return e.url;
        }).indexOf(g_current_url);

        if (index >= 0 && index < stations[g_current_country].length) {
            $(".current-station").html(stations[g_current_country][index].name);
            $(".current-station-image").attr("src", getFullLogoUrl(stations[g_current_country][index].logo));
            $(".current-station-country").html(country_properties[g_current_country].name);
            $(".current-station-flag").attr("src", "lib/flags/" + country_properties[g_current_country].code + ".svg");

            if(g_favourites[g_current_country] == stations[g_current_country][index].name) {
                $(".music-controller-favourite > button, .music-controller-favourite").css("color", "#f65454");
            } else {
                $(".music-controller-favourite > button, .music-controller-favourite").css("color", "var(--md-sys-color-on-surface)");
            }
        }
    }

    g_stations = available_stations;
};

// Scroll to station with smooth animation
var originalScrollToStation = scrollToStation;
scrollToStation = function() {
    var selected = document.querySelector('.station-card.selected');
    if (selected) {
        selected.scrollIntoView({
            behavior: 'smooth',
            block: 'center'
        });
    }
};

// Enhanced snackbar with animation
var originalSetFavouriteStation = setFavouriteStation;
setFavouriteStation = function(country, name) {
    if(controlRemote){
        conn.send(JSON.stringify({
            type: "favourite",
            country: country,
            name: name
        }));
        setTimeout(function () {
            refreshFavourites(function () {
                refreshStations();
            });
        }, 500);
    } else {
        $.get(g_api + "/favourite/" + country + "/" + encodeURIComponent(name), function(){
            var snackbar = document.getElementById('snackbar');
            snackbar.innerHTML = '<i class="fa-solid fa-heart" style="color: #f65454;"></i> ' +
                country_properties[country].name + ' - ' + name;
            snackbar.classList.add('show');
            setTimeout(function () {
                snackbar.classList.remove('show');
            }, 3000);
            refreshFavourites(function () {
                refreshStations();
            });
        });
    }
};

// Add ripple effect to buttons
document.addEventListener('click', function(e) {
    var button = e.target.closest('.ripple');
    if (button) {
        var rect = button.getBoundingClientRect();
        var ripple = document.createElement('span');
        ripple.className = 'ripple-effect';
        ripple.style.left = (e.clientX - rect.left) + 'px';
        ripple.style.top = (e.clientY - rect.top) + 'px';
        button.appendChild(ripple);
        setTimeout(function() {
            ripple.remove();
        }, 600);
    }
});

// Add CSS for ripple effect dynamically
var rippleStyle = document.createElement('style');
rippleStyle.textContent = `
    .ripple-effect {
        position: absolute;
        border-radius: 50%;
        background: rgba(255, 255, 255, 0.4);
        transform: scale(0);
        animation: ripple-animation 0.6s linear;
        pointer-events: none;
    }
    @keyframes ripple-animation {
        to {
            transform: scale(4);
            opacity: 0;
        }
    }
`;
document.head.appendChild(rippleStyle);

console.log('Modern UI enhancements loaded');
