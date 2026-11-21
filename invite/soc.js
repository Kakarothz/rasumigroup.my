/* Discord icon: copy the username (Discord has no public link by username) */
(function(){document.addEventListener('click',function(e){var b=e.target.closest&&e.target.closest('.soc-dc');if(!b)return;
var u=b.getAttribute('data-copy')||'';var done=function(){var t=document.createElement('div');t.className='soc-toast';t.textContent='Discord username copied: '+u;document.body.appendChild(t);setTimeout(function(){t.remove()},2200)};
if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(u).then(done,done)}else{var i=document.createElement('input');i.value=u;document.body.appendChild(i);i.select();try{document.execCommand('copy')}catch(_){}i.remove();done()}})})();
