/* Last Card site: a section link (nav, footer) still jumps to its section, but the address keeps no
   "#section". A phone's address bar hides that part, and every later open of the address would land on
   the section again instead of the hero. A section address opened on purpose still lands there first. */
const clean = () => { if (location.hash) history.replaceState(history.state, '', location.pathname + location.search); };
addEventListener('hashchange', clean);
addEventListener('load', clean);
