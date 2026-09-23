const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const pool = require("./db");
const { setupSocket } = require("./socket");

const app = express();
const server = http.createServer(app); //socket.io need access to raw http server, and not just express
const io = new Server(server);

app.use(express.json()); //parse incoming request
app.use(express.static(path.join(__dirname, "../client"))); //serves frontend

app.use(function (req, res, next) {
  console.log(req.method + " " + req.url);
  next();
});

app.get("/api/seats/:showId", async function (req, res) {
  const showId = req.params.showId;
  console.log("showId =", showId);
  try {
    const result = await pool.query("SELECT * FROM seats WHERE show_id = $1", [
      showId,
    ]);
    res.json({ showId: showId, seats: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch seats" });
  }
});

setupSocket(io);

server.listen(3000, function () {
  console.log("CineBook running at http://localhost:3000");
});
