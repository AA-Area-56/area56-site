// Hide events that have already happened, so the site never shows stale
// events even if nobody has rebuilt it in a while.
(function () {
  var today = new Date();
  var iso = today.getFullYear() + "-" +
    String(today.getMonth() + 1).padStart(2, "0") + "-" +
    String(today.getDate()).padStart(2, "0");

  document.querySelectorAll("[data-upcoming]").forEach(function (list) {
    var limit = parseInt(list.getAttribute("data-limit") || "0", 10);
    var shown = 0;
    list.querySelectorAll("[data-event-date]").forEach(function (item) {
      var past = item.getAttribute("data-event-date") < iso;
      var overLimit = limit && shown >= limit;
      if (past || overLimit) {
        item.hidden = true;
      } else {
        shown++;
      }
    });
    if (shown === 0) {
      var empty = list.nextElementSibling;
      if (empty && empty.classList.contains("empty")) empty.hidden = false;
    }
  });
})();
