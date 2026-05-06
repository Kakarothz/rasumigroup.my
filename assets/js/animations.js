// ============================================
// RASUMI GROUP — ANIMATIONS JS
// Handles: IntersectionObserver scroll reveals,
//          network grid card animation
// ============================================

document.addEventListener('DOMContentLoaded', () => {

    // --- Scroll Reveal (IntersectionObserver) ---
    const scrollContainer = document.querySelector('.scroll-container');

    if (scrollContainer) {
        const observerOptions = {
            root: scrollContainer,
            threshold: 0.1
        };

        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    entry.target.style.opacity = '1';
                    entry.target.style.transform = 'translateY(0)';
                }
            });
        }, observerOptions);

        document.querySelectorAll('.service-card, .team-card, .about-content').forEach(el => {
            el.style.opacity = '0';
            el.style.transform = 'translateY(30px)';
            el.style.transition = 'all 0.6s ease-out';
            observer.observe(el);
        });
    }

    // --- Network Grid Card Animation ---
    const grid = document.querySelector('.network-grid');
    if (!grid) return;

    const cards = Array.from(grid.children);
    let isPaused = false;
    let progress = 0;
    const speed = 0.0005;

    // Define 8 anchor points for the 2x4 grid [x, y] in percentage
    const points = [
        { x: 0,  y: 0  },  // Slot 0 (Top-Left)
        { x: 25, y: 0  },  // Slot 1
        { x: 50, y: 0  },  // Slot 2
        { x: 75, y: 0  },  // Slot 3 (Top-Right)
        { x: 75, y: 33 },  // Slot 4 (Bottom-Right)
        { x: 50, y: 33 },  // Slot 5
        { x: 25, y: 33 },  // Slot 6
        { x: 0,  y: 33 }   // Slot 7 (Bottom-Left)
    ];

    function animate() {
        if (!isPaused) {
            progress += speed;
            if (progress >= 1) progress = 0;

            cards.forEach((card, i) => {
                const currentPos = (i + (progress * 8)) % 8;
                const index = Math.floor(currentPos);
                const nextIndex = (index + 1) % 8;
                const factor = currentPos - index;

                const x = points[index].x + (points[nextIndex].x - points[index].x) * factor;
                const y = points[index].y + (points[nextIndex].y - points[index].y) * factor;

                card.style.left = `${x}%`;
                card.style.top = `${y * 4}px`;

                if (y < 10) {
                    card.classList.add('in-top-row');
                } else {
                    card.classList.remove('in-top-row');
                }
            });
        }
        requestAnimationFrame(animate);
    }

    // Pause on hover
    grid.addEventListener('mouseenter', () => isPaused = true);
    grid.addEventListener('mouseleave', () => isPaused = false);

    // Start animation
    animate();
});
