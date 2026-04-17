const { app } = require('electron');
console.log('hasApp', !!app);
app.whenReady().then(() => {
  console.log('ready');
  app.exit(0);
});
