// Runs before the page paints. Scroll animations only hide content when this class is present,
// so the site stays fully readable if scripts are blocked or fail to load.
document.documentElement.classList.add('js');
