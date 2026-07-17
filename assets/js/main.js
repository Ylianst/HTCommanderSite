/* =========================================================================
   HTCommander site — interactions
   Mobile nav, sticky-nav shadow, gallery tabs, smooth in-page scrolling.
   ========================================================================= */
(function () {
  "use strict";

  /* ---- Sticky nav: add border/shadow once scrolled ---- */
  var nav = document.getElementById("nav");
  if (nav) {
    var onScroll = function () {
      nav.classList.toggle("is-scrolled", window.scrollY > 8);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
  }

  /* ---- Mobile nav toggle ---- */
  var toggle = document.getElementById("navToggle");
  if (nav && toggle) {
    toggle.addEventListener("click", function () {
      var open = nav.classList.toggle("is-open");
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
    });

    // Close the menu after tapping a link.
    var links = document.getElementById("navLinks");
    if (links) {
      links.addEventListener("click", function (e) {
        if (e.target.tagName === "A") {
          nav.classList.remove("is-open");
          toggle.setAttribute("aria-expanded", "false");
        }
      });
    }
  }

  /* ---- Screenshot gallery tabs ---- */
  var gallery = document.getElementById("gallery");
  if (gallery) {
    var tabs = gallery.querySelectorAll(".gallery__tab");
    tabs.forEach(function (tab) {
      tab.addEventListener("click", function () {
        var targetId = tab.getAttribute("data-target");

        tabs.forEach(function (t) { t.classList.remove("is-active"); });
        tab.classList.add("is-active");

        gallery.querySelectorAll(".gallery__panel").forEach(function (panel) {
          panel.classList.toggle("is-active", panel.id === targetId);
        });
      });
    });
  }
})();
