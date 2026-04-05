const showId = "show_001";
const userId = "user_" + Math.random().toString(36).slice(2, 7);
var selectedSeats = [];

// Connect to Socket.io server
const socket = io();

// When we connect — join the show room
socket.on("connect", function () {
  console.log("Connected to server! My ID: " + socket.id);
  socket.emit("join_show", { showId: showId });
});

// Server sends us ALL current seat states on join
socket.on("seat_states", function (data) {
  renderSeats(data.seats);
});

// Another user locked a seat → show lock instantly
socket.on("seat_locked", function (data) {
  const seatEl = document.querySelector('[data-id="' + data.seatId + '"]');
  if (seatEl && !selectedSeats.includes(data.seatId)) {
    seatEl.className = "seat locked";
    seatEl.disabled = true;
    seatEl.textContent = data.seatId + " 🔒";
  }
});

// A seat was unlocked → make it available again
socket.on("seat_unlocked", function (data) {
  const seatEl = document.querySelector('[data-id="' + data.seatId + '"]');
  if (seatEl) {
    seatEl.className = "seat available";
    seatEl.disabled = false;
    seatEl.textContent = data.seatId;
  }
});

// Seats permanently booked → mark as taken
socket.on("seats_booked", function (data) {
  data.seatIds.forEach(function (seatId) {
    const seatEl = document.querySelector('[data-id="' + seatId + '"]');
    if (seatEl) {
      seatEl.className = "seat taken";
      seatEl.disabled = true;
      seatEl.textContent = seatId;
    }
  });
  selectedSeats = [];
  updateBookButton();
});

// Lock failed — someone else got it first
socket.on("lock_failed", function (data) {
  alert("Seat " + data.seatId + " was just taken by someone else!");
  const seatEl = document.querySelector('[data-id="' + data.seatId + '"]');
  if (seatEl) {
    seatEl.className = "seat locked";
    seatEl.disabled = true;
  }
  selectedSeats = selectedSeats.filter(function (id) {
    return id !== data.seatId;
  });
  updateBookButton();
});

function renderSeats(seats) {
  const seatMap = document.getElementById("seat-map");
  seatMap.innerHTML = "";

  seats.forEach(function (seat) {
    const btn = document.createElement("button");
    btn.dataset.id = seat.id;
    btn.dataset.price = seat.price;

    if (seat.status === "available") {
      btn.className = "seat available";
      btn.textContent = seat.id;
      btn.addEventListener("click", function () {
        toggleSeat(btn, seat);
      });
    } else if (seat.status === "locked") {
      btn.className = "seat locked";
      btn.textContent = seat.id + " 🔒";
      btn.disabled = true;
    } else {
      btn.className = "seat taken";
      btn.textContent = seat.id;
      btn.disabled = true;
    }

    seatMap.appendChild(btn);
  });
}

function toggleSeat(btn, seat) {
  const index = selectedSeats.indexOf(seat.id);

  if (index !== -1) {
    // Deselect → unlock
    selectedSeats.splice(index, 1);
    btn.className = "seat available";
    btn.textContent = seat.id;
    socket.emit("unlock_seat", { showId: showId, seatId: seat.id });
  } else {
    // Select → lock
    selectedSeats.push(seat.id);
    btn.className = "seat selected";
    socket.emit("lock_seat", {
      showId: showId,
      seatId: seat.id,
      userId: userId,
    });
  }

  updateBookButton();
}

function updateBookButton() {
  const bookBtn = document.getElementById("book-btn");
  if (selectedSeats.length > 0) {
    bookBtn.disabled = false;
    bookBtn.textContent = "Book " + selectedSeats.length + " seat(s)";
  } else {
    bookBtn.disabled = true;
    bookBtn.textContent = "Select seats first";
  }
}

document.getElementById("book-btn").addEventListener("click", function () {
  socket.emit("book_seats", {
    showId: showId,
    seatIds: selectedSeats,
    userId: userId,
  });
  document.getElementById("message").textContent = "Booking confirmed!";
});
