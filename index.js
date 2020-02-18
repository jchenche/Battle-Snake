const bodyParser = require('body-parser')
const express = require('express')
const logger = require('morgan')
const app = express()
const {
  fallbackHandler,
  notFoundHandler,
  genericErrorHandler,
  poweredByHandler
} = require('./handlers.js')

// For deployment to Heroku, the port needs to be set using ENV, so
// we check for the port number in process.env
app.set('port', (process.env.PORT || 9001))

app.enable('verbose errors')

app.use(logger('dev'))
app.use(bodyParser.json())
app.use(poweredByHandler)

// --- SNAKE LOGIC GOES BELOW THIS LINE ---

// Handle POST request to '/start'
app.post('/start', (request, response) => {
  // NOTE: Do something here to start the game

  // Response data
  const data = {
    "color": '#0F52BA',
    "headType": "bwc-snowman",
    "tailType": "bwc-bonhomme"
  }

  return response.json(data)
})

function shuffle_array(arr) {
  var i, j, temp
  for (i = arr.length - 1; i > 0; i--) {
      j = Math.floor(Math.random() * (i + 1))
      temp = arr[i]
      arr[i] = arr[j]
      arr[j] = temp
  }
  return arr
}

function get_future_pos(x_head, y_head, move) {
  if (move == "up") return [x_head, y_head - 1]
  else if (move == "left") return [x_head - 1, y_head]
  else if (move == "down") return [x_head, y_head + 1]
  else return [x_head + 1, y_head]
}

const stringify = (coord) => { return coord[0].toString() + "," + coord[1].toString() }

const get_north = (coord) => { return [coord[0], coord[1] - 1] }
const get_west = (coord) => { return [coord[0] - 1, coord[1]] }
const get_south = (coord) => { return [coord[0], coord[1] + 1] }
const get_east = (coord) => { return [coord[0] + 1, coord[1]] }

function get_obstacles_coord(req) {
  var coord = {}

  var snakes = req.body.board.snakes
  for (let snake of snakes) {
    var snake_body = snake.body
    // Use a number to encode the snake's length and indicate that it's a snake head (by being a type number)
    coord[stringify([snake_body[0].x, snake_body[0].y])] = snake_body.length
    for (var i = 1; i < snake_body.length - 2; i++) {
      coord[stringify([snake_body[i].x, snake_body[i].y])] = "body"
    }
    // If a snake ate, its body size in the next turn will be incremented by 1 (that's why this case is handled)
    coord[stringify([snake_body[snake_body.length - 2].x, snake_body[snake_body.length - 2].y])] = "tail"
  }

  var x_max = req.body.board.width
  var y_max = req.body.board.height
  for (var i = 0; i < x_max; i++) {
    coord[stringify([i, -1])] = "wall" // Top wall
    coord[stringify([i, y_max])] = "wall" // Bottom wall
  }
  for (var i = 0; i < y_max; i++) {
    coord[stringify([-1, i])] = "wall" // Left wall
    coord[stringify([x_max, i])] = "wall" // Right wall
  }

  return coord
}

function get_foods_coord(req) {
  var coord = {}
  var foods = req.body.board.food
  for (let food of foods) coord[stringify([food.x, food.y])] = "food"
  return coord
}

function is_legal_move(req, obstacles_coord, move) {
  // Make sure it doesn't eat itself and collide with obstacles
  var x_head = req.body.you.body[0].x
  var y_head = req.body.you.body[0].y
  future_pos = get_future_pos(x_head, y_head, move)
  return !(stringify(future_pos) in obstacles_coord)
}

function is_own_tail(req, stringed_coord) {
  var my_length = req.body.you.body.length
  var my_tail = req.body.you.body[my_length - 1]
  return stringed_coord == stringify([my_tail.x, my_tail.y])
}

const HEALTH_THRESHOLD = 25
const DEPTH_PARAMETER_DIVISOR = 15
const TIME_TO_DIET = 100
const SIZE_TO_CHASE_ITSELF = 10

function transform_battle_score(enemy_length, my_length, score) {
  if (enemy_length >= my_length) return score - 5
  return score + 1
}

function transform_food_score(req, score) {
  if (req.body.turn < TIME_TO_DIET || req.body.you.health < HEALTH_THRESHOLD) return score + 5
  return score + 1
}

function local_space_score(req, obstacles_coord, move) {
  var score = 0

  var x_head = req.body.you.body[0].x
  var y_head = req.body.you.body[0].y
  var future_pos = get_future_pos(x_head, y_head, move)
  var futures = [get_north(future_pos), get_west(future_pos), get_south(future_pos), get_east(future_pos)]

  var my_length = req.body.you.body.length
  var enemy_length

  for (let future of futures) {
    if (stringify(future) in obstacles_coord) {
      score -= 1 // Decrement score by 1 for every immediate obstacle
      enemy_length = obstacles_coord[stringify(future)]
      if (typeof enemy_length == "number") { // type number means it's a snake head
        score = transform_battle_score(enemy_length, my_length, score)
      }
    }
  }

  // foods_coord is mutually exclusive with obstacles_coord
  var foods_coord = get_foods_coord(req)
  for (let future of futures) {
    if (stringify(future) in foods_coord) score = transform_food_score(req, score)
  }

  return score
}

function limited_BFS(req, queue, marked, obstacles_coord, foods_coord, score) {
  var curr = queue.shift()
  var curr_coord = curr[0]
  var curr_depth = curr[1]

  score.s += 1 // Increment score by 1 for every space explored
  if (stringify(curr_coord) in foods_coord) score.s = transform_food_score(req, score.s)
  if (is_own_tail(req , stringify(curr_coord)) && req.body.you.body.length > SIZE_TO_CHASE_ITSELF)
    score.s += curr_depth

  if (curr_depth <= 0) return

  var futures = [get_north(curr_coord), get_west(curr_coord), get_south(curr_coord), get_east(curr_coord)]

  for (let future of futures) {
    var stringed_future = stringify(future)
    if (!(stringed_future in marked) && !(stringed_future in obstacles_coord)) {
      marked[stringed_future] = "marked"
      queue.push([future, curr_depth - 1])
    }
  }

  if (queue.length > 0) limited_BFS(req, queue, marked, obstacles_coord, foods_coord, score)
}

function global_space_score(req, obstacles_coord, move) {
  var x_head = req.body.you.body[0].x
  var y_head = req.body.you.body[0].y
  var future_pos = get_future_pos(x_head, y_head, move)

  var foods_coord = get_foods_coord(req)

  var depth = Math.ceil(req.body.turn / DEPTH_PARAMETER_DIVISOR)
  var queue = [[future_pos, depth]] // List of (coord, depth) pairs

  var marked = {}
  marked[stringify(future_pos)] = "marked"

  var score = { "s": 0 }
  limited_BFS(req, queue, marked, obstacles_coord, foods_coord, score)
  return score.s
}

function get_best_move(req, obstacles_coord) {
  var move_rankings = shuffle_array(["up", "left", "down", "right"])
  move_rankings = move_rankings.map(move => [move, 0])
  move_rankings = move_rankings.filter(move => is_legal_move(req, obstacles_coord, move[0]))
  if (move_rankings.length == 0) {
    console.log("====== No legal moves available ======")
    return "up"
  }
  
  move_rankings = move_rankings.map(move => [move[0], move[1] + local_space_score(req, obstacles_coord, move[0])])
  move_rankings = move_rankings.map(move => [move[0], move[1] + global_space_score(req, obstacles_coord, move[0])])

  move_rankings.sort((a, b) => b[1] - a[1])
  console.log("Turn: " + req.body.turn + ". Move rankings ======> " + move_rankings)
  return move_rankings[0][0] // Move with the highest score
}

// Handle POST request to '/move'
app.post('/move', (req, res) => {
  // NOTE: Do something here to generate your move

  // Response data
  const data = {
    move: "up", // coordinate (0,0) is at the upper left corner
  }

  var obstacles_coord = get_obstacles_coord(req)

  data.move = get_best_move(req, obstacles_coord)

  return res.json(data)
})

app.post('/end', (request, response) => {
  // NOTE: Any cleanup when a game is complete.
  return response.json({})
})

app.post('/ping', (request, response) => {
  // Used for checking if this snake is still alive.
  return response.json({});
})

// --- SNAKE LOGIC GOES ABOVE THIS LINE ---

app.use('*', fallbackHandler)
app.use(notFoundHandler)
app.use(genericErrorHandler)

app.listen(app.get('port'), () => {
  console.log('Server listening on port %s', app.get('port'))
})
