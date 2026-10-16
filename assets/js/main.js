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

  /* ---- Hero feature slideshow (auto-cycles every 3s) ---- */
  var featureShow = document.getElementById("featureShow");
  var featureCaption = document.getElementById("featureCaption");
  if (featureShow && featureCaption) {
    var slides = featureShow.querySelectorAll(".feature-show__slide");
    // Slide images ship as data-src/data-srcset so only the visible and the
    // upcoming slide are downloaded, not the whole slideshow up front.
    var hydrate = function (slide) {
      if (!slide) { return; }
      slide.querySelectorAll("source[data-srcset]").forEach(function (source) {
        source.setAttribute("srcset", source.getAttribute("data-srcset"));
        source.removeAttribute("data-srcset");
      });
      slide.querySelectorAll("img[data-src]").forEach(function (img) {
        img.setAttribute("src", img.getAttribute("data-src"));
        img.removeAttribute("data-src");
      });
    };
    var captions = [];
    try {
      captions = JSON.parse(featureCaption.getAttribute("data-captions") || "[]");
    } catch (err) {
      captions = [];
    }

    if (slides.length === 1) { hydrate(slides[0]); }

    if (slides.length > 1) {
      var current = Math.floor(Math.random() * slides.length);
      slides.forEach(function (slide, index) {
        slide.classList.toggle("is-active", index === current);
      });
      hydrate(slides[current]);
      hydrate(slides[(current + 1) % slides.length]);
      if (captions[current] != null) {
        featureCaption.textContent = captions[current];
      }
      var advance = function () {
        var next = (current + 1) % slides.length;

        slides[current].classList.remove("is-active");
        hydrate(slides[next]);
        slides[next].classList.add("is-active");
        hydrate(slides[(next + 1) % slides.length]);

        featureCaption.classList.add("is-fading");
        window.setTimeout(function () {
          if (captions[next] != null) {
            featureCaption.textContent = captions[next];
          }
          featureCaption.classList.remove("is-fading");
        }, 350);

        current = next;
      };

      window.setInterval(advance, 3000);

      // Clicking the hero slideshow opens the full feature gallery.
      var stage = featureShow.querySelector(".feature-show__stage");
      if (stage) {
        stage.setAttribute("role", "link");
        stage.setAttribute("tabindex", "0");
        stage.setAttribute("title", "Browse all features");
        var openGallery = function () {
          window.location.href = "feature-gallery.html";
        };
        stage.addEventListener("click", openGallery);
        stage.addEventListener("keydown", function (event) {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            openGallery();
          }
        });
      }
    }
  }

  /* ---- Feature gallery (manual, self-paced browsing) ---- */
  var galleryData = document.getElementById("galleryData");
  var galleryImage = document.getElementById("galleryImage");
  if (galleryData && galleryImage) {
    var items = [];
    try {
      items = JSON.parse(galleryData.textContent || "[]");
    } catch (err) {
      items = [];
    }

    if (items.length > 0) {
      var gBadge = document.getElementById("galleryBadge");
      var gTitle = document.getElementById("galleryTitle");
      var gDesc = document.getElementById("galleryDesc");
      var gIndex = document.getElementById("galleryIndex");
      var gTotal = document.getElementById("galleryTotal");
      var gDots = document.getElementById("galleryDots");
      var gPrev = document.getElementById("galleryPrev");
      var gNext = document.getElementById("galleryNext");
      var gCurrent = 0;

      if (gTotal) { gTotal.textContent = String(items.length); }

      // Serve the AVIF/WebP renditions made by tools/image-optimizer when
      // the item lists its widths; the PNG in "img" stays as the fallback.
      var gSources = [];
      var gPicture = galleryImage.parentNode;
      if (gPicture && gPicture.nodeName === "PICTURE") {
        var gSizes = galleryImage.getAttribute("data-sizes") || "100vw";
        [["avif", "image/avif"], ["webp", "image/webp"]].forEach(function (fmt) {
          var source = document.createElement("source");
          source.type = fmt[1];
          source.setAttribute("sizes", gSizes);
          gPicture.insertBefore(source, galleryImage);
          gSources.push({ el: source, ext: fmt[0] });
        });
      }

      var dotButtons = [];
      if (gDots) {
        items.forEach(function (item, index) {
          var dot = document.createElement("button");
          dot.className = "gallery__dot";
          dot.type = "button";
          dot.setAttribute("role", "tab");
          dot.setAttribute("aria-label", item.title || "Feature " + (index + 1));
          dot.addEventListener("click", function () { show(index); });
          gDots.appendChild(dot);
          dotButtons.push(dot);
        });
      }

      var render = function () {
        var item = items[gCurrent];
        var parts = item.widths ? item.img.match(/^(.*\/)?([^\/]+)\.png$/) : null;
        gSources.forEach(function (source) {
          if (parts) {
            source.el.setAttribute("srcset", item.widths.map(function (w) {
              return (parts[1] || "") + "web/" + parts[2] + "-" + w + "." + source.ext + " " + w + "w";
            }).join(", "));
          } else {
            source.el.removeAttribute("srcset");
          }
        });
        galleryImage.src = item.img;
        galleryImage.alt = item.title || "";
        if (gBadge) { gBadge.textContent = item.badge || ""; }
        if (gTitle) { gTitle.textContent = item.title || ""; }
        if (gDesc) { gDesc.textContent = item.desc || ""; }
        if (gIndex) { gIndex.textContent = String(gCurrent + 1); }
        dotButtons.forEach(function (dot, index) {
          var active = index === gCurrent;
          dot.classList.toggle("is-active", active);
          dot.setAttribute("aria-selected", active ? "true" : "false");
        });
      };

      var show = function (index) {
        var next = (index + items.length) % items.length;
        if (next === gCurrent) { return; }
        gCurrent = next;
        galleryImage.classList.add("is-fading");
        window.setTimeout(function () {
          render();
          galleryImage.classList.remove("is-fading");
        }, 200);
      };

      if (gPrev) { gPrev.addEventListener("click", function () { show(gCurrent - 1); }); }
      if (gNext) { gNext.addEventListener("click", function () { show(gCurrent + 1); }); }

      document.addEventListener("keydown", function (event) {
        if (event.key === "ArrowLeft") { show(gCurrent - 1); }
        else if (event.key === "ArrowRight") { show(gCurrent + 1); }
      });

      render();
    }
  }
})();
