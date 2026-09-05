(function () {
  "use strict";

  var headerMark = document.getElementById("headerMark");
  var fadeEls = Array.prototype.slice.call(document.querySelectorAll("[data-fade]"));
  var footer = document.getElementById("siteFooter");
  var ticks = 0;

  function clamp01(v) {
    return Math.min(1, Math.max(0, v));
  }

  function update() {
    var y = window.scrollY;
    var vh = window.innerHeight;

    // Header logo-mark: fades from opacity 1 at the top of the page to 0
    // by 260px of scroll, then stays hidden.
    if (headerMark) {
      var p = clamp01(y / 260);
      headerMark.style.opacity = String(Math.max(0, 1 - p * 2.2).toFixed(2));
    }

    // Section reveal: only start once the loop has proven it runs a few
    // times, so slow/blocked JS never leaves a section stuck invisible.
    if (ticks > 2) {
      fadeEls.forEach(function (el) {
        var r = el.getBoundingClientRect();
        var out = clamp01((vh * 0.5 - r.bottom) / (vh * 0.35));
        var inn = clamp01((vh * 0.94 - r.top) / (vh * 0.24));
        var o = Math.min(inn, 1 - out);
        el.style.opacity = o.toFixed(3);
        el.style.transform = "translateY(" + (out * -26 + (1 - inn) * 22).toFixed(1) + "px)";
      });
    }

    // Footer CTA + wordmark reveal once the footer scrolls into view.
    if (footer && ticks > 2) {
      var inView = footer.getBoundingClientRect().top < vh * 0.85;
      footer.classList.toggle("in-view", inView);
    }
  }

  function tick() {
    ticks++;
    update();
    requestAnimationFrame(tick);
  }
  // rAF can be throttled to nothing in some contexts; keep a timer fallback.
  setInterval(function () {
    ticks++;
    update();
  }, 250);
  requestAnimationFrame(tick);

  window.addEventListener("resize", update, { passive: true });

  // Count-up stats
  document.querySelectorAll("[data-count]").forEach(function (el) {
    var raw = el.getAttribute("data-count") || el.textContent;
    var m = raw.match(/[\d,.]+/);
    if (!m) return;
    var target = parseFloat(m[0].replace(/,/g, ""));
    var pre = raw.slice(0, m.index);
    var post = raw.slice(m.index + m[0].length);
    var grouped = m[0].indexOf(",") !== -1;
    function fmt(v) {
      return pre + (grouped ? v.toLocaleString("en-US") : String(v)) + post;
    }
    function start() {
      var t0 = Date.now();
      var dur = 1400;
      function step() {
        var k = Math.min(1, (Date.now() - t0) / dur);
        el.textContent = fmt(Math.round(target * (1 - Math.pow(1 - k, 3))));
        if (k < 1) setTimeout(step, 40);
        else el.textContent = raw;
      }
      el.textContent = fmt(0);
      step();
    }
    setTimeout(start, 500);
  });

  // Nav pill hover indicator
  var nav = document.getElementById("siteNav");
  var pill = document.getElementById("navPill");
  if (nav && pill) {
    nav.querySelectorAll(".nav-link").forEach(function (link) {
      link.addEventListener("mouseenter", function () {
        pill.style.left = link.offsetLeft + "px";
        pill.style.width = link.offsetWidth + "px";
        pill.style.opacity = "1";
      });
    });
    nav.addEventListener("mouseleave", function () {
      pill.style.opacity = "0";
    });
  }

  // FAQ accordion — one open at a time
  document.querySelectorAll(".faq-item").forEach(function (item) {
    var row = item.querySelector(".faq-row");
    if (!row) return;
    row.addEventListener("click", function () {
      var wasOpen = item.classList.contains("open");
      document.querySelectorAll(".faq-item.open").forEach(function (open) {
        open.classList.remove("open");
      });
      if (!wasOpen) item.classList.add("open");
    });
  });
})();
