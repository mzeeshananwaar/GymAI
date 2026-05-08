function joinNow() {
  alert("Welcome to Elite Gym 💪");
}

// Apne laptop ka IP address yahan variable mein set karein
const BASE_URL = window.location.origin;
// 1. Database se Real User Count lena
fetch(`${BASE_URL}/api/public-user-count`)    .then(res => res.json())
    .then(data => {
        const userElement = document.getElementById('user-count');
        if (userElement) {
            userElement.innerText = data.count + "+";
        }
    })
    .catch(err => console.log("Counter error:", err));

// 2. Baki Counters Animate karna
const counters = document.querySelectorAll('.count');
counters.forEach(counter => {
    const target = +counter.getAttribute('data-target');
    let count = 0;
    const update = () => {
        const inc = target / 100;
        if(count < target) {
            count += inc;
            counter.innerText = Math.ceil(count) + "+";
            setTimeout(update, 20);
        }
    };
    update();
});

// 3. Simple Timer
let timeLeft = 30;
function startTimer() {
    const btn = document.getElementById('timer-btn');
    btn.disabled = true;
    let timerId = setInterval(() => {
        if(timeLeft <= 0) {
            clearInterval(timerId);
            document.getElementById('timer-display').innerText = "Done!";
            timeLeft = 30;
            btn.disabled = false;
        } else {
            document.getElementById('timer-display').innerText = timeLeft + "s";
            timeLeft--;
        }
    }, 1000);
}