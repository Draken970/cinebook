const pool = require("./db");
const redis = require("redis");

// Create Redis client
const redisClient = redis.createClient({
  host: "localhost",
  port: 6379,
});

redisClient.on("error", function (err) {
  console.error("Redis error:", err.message);
});

redisClient.on("connect", function () {
  console.log("Connected to Redis successfully!");
});

redisClient.connect();

const LOCK_TTL = 30;

function setupSocket(io) {
  io.on("connection", function (socket) {
    console.log("User connected: " + socket.id);

    socket.on("join_show", async function (data) {
      const showId = data.showId;
      socket.join(showId);

      try {
        const result = await pool.query(
          "SELECT * FROM seats WHERE show_id = $1",
          [showId],
        );

        // For each seat, check Redis for lock info
        const seats = result.rows;
        for (const seat of seats) {
          if (seat.status === "locked") {
            // Check if Redis lock still exists
            const lockKey = "lock:" + showId + ":" + seat.id;
            const lockOwner = await redisClient.get(lockKey);

            // If Redis has no lock but DB says locked
            // it means TTL expired — reset to available
            if (!lockOwner) {
              await pool.query("UPDATE seats SET status = $1 WHERE id = $2", [
                "available",
                seat.id,
              ]);
              seat.status = "available";
            }
          }
        }

        socket.emit("seat_states", { seats: seats });
      } catch (err) {
        console.error("Error:", err.message);
      }
    });

    socket.on("lock_seat", async function (data) {
      const showId = data.showId;
      const seatId = data.seatId;
      const userId = data.userId;
      const lockKey = "lock:" + showId + ":" + seatId;

      try {
        // Check DB status first
        const check = await pool.query(
          "SELECT status FROM seats WHERE id = $1",
          [seatId],
        );

        if (check.rows[0].status !== "available") {
          socket.emit("lock_failed", { seatId: seatId });
          return;
        }

        // SET NX = "Set if Not eXists" — ATOMIC operation
        // This is the magic that prevents double booking!
        // If two users click at the same millisecond,
        // Redis guarantees only ONE of them gets NX = true
        const lockAcquired = await redisClient.set(lockKey, userId, {
          NX: true, // Only set if key doesn't exist
          EX: LOCK_TTL, // Expire after 600 seconds
        });

        if (!lockAcquired) {
          // Another user got the lock first
          socket.emit("lock_failed", { seatId: seatId });
          return;
        }

        // Lock acquired! Update DB and broadcast
        await pool.query("UPDATE seats SET status = $1 WHERE id = $2", [
          "locked",
          seatId,
        ]);

        io.to(showId).emit("seat_locked", {
          seatId: seatId,
          lockedBy: userId,
        });

        // Auto unlock after TTL expires
        // This handles users who close the tab without booking
        setTimeout(async function () {
          const stillLocked = await redisClient.get(lockKey);
          if (stillLocked === userId) {
            await redisClient.del(lockKey);
            await pool.query("UPDATE seats SET status = $1 WHERE id = $2", [
              "available",
              seatId,
            ]);
            io.to(showId).emit("seat_unlocked", { seatId: seatId });
            console.log("Auto-unlocked seat: " + seatId);
          }
        }, LOCK_TTL * 1000);
      } catch (err) {
        console.error("Lock error:", err.message);
      }
    });

    socket.on("unlock_seat", async function (data) {
      const showId = data.showId;
      const seatId = data.seatId;
      const userId = data.userId;
      const lockKey = "lock:" + showId + ":" + seatId;

      try {
        // Only unlock if this user owns the lock
        const lockOwner = await redisClient.get(lockKey);

        if (lockOwner === userId) {
          await redisClient.del(lockKey);
          await pool.query("UPDATE seats SET status = $1 WHERE id = $2", [
            "available",
            seatId,
          ]);
          io.to(showId).emit("seat_unlocked", { seatId: seatId });
        }
      } catch (err) {
        console.error("Unlock error:", err.message);
      }
    });

    socket.on("book_seats", async function (data) {
      const showId = data.showId;
      const seatIds = data.seatIds;
      const userId = data.userId;

      try {
        for (const seatId of seatIds) {
          const lockKey = "lock:" + showId + ":" + seatId;

          // Verify this user owns the Redis lock
          const lockOwner = await redisClient.get(lockKey);
          if (lockOwner !== userId) {
            socket.emit("lock_failed", { seatId: seatId });
            return;
          }

          // Delete Redis lock — seat is now permanently taken
          await redisClient.del(lockKey);

          // Save permanently in PostgreSQL
          await pool.query("UPDATE seats SET status = $1 WHERE id = $2", [
            "taken",
            seatId,
          ]);

          await pool.query(
            "INSERT INTO bookings (user_id, show_id, seat_id) VALUES ($1, $2, $3)",
            [userId, showId, seatId],
          );
        }

        io.to(showId).emit("seats_booked", { seatIds: seatIds });
      } catch (err) {
        console.error("Booking error:", err.message);
      }
    });

    // When user closes tab — release their locks
    socket.on("disconnect", async function () {
      console.log("User disconnected: " + socket.id);
    });
  });
}

module.exports = { setupSocket };
