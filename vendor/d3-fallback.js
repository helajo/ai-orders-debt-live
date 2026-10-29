/* d3 is vendored next to the page (vendor/d3.v7.min.js). If that file is missing from a deployment, load the same
   version from cdnjs. document.write keeps the script parser-blocking, so app.js still finds window.d3. */
if (!window.d3) {
  document.write('<script src="https://cdnjs.cloudflare.com/ajax/libs/d3/7.9.0/d3.min.js"><\/script>');
}
