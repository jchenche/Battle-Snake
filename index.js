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

app.post('/start', (request, response) => {
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

function get_move_pos(x_head, y_head, move) {
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
    // If a snake ate, its body size in the next turn will be incremented by 1 and
    // the second last position will be on top of the last (grown) position
    // so that space will be successfully registered as an obstacle in this case.
    // Note that the tail below is a tail of the next turn and not the current turn.
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
  var move_pos = get_move_pos(x_head, y_head, move)
  return !(stringify(move_pos) in obstacles_coord)
}

function is_current_tail(req, curr_coord) {
  var stringed_curr = stringify(curr_coord)
  var snakes = req.body.board.snakes
  for (let snake of snakes) {
    var snake_body = snake.body
    var snake_length = snake_body.length
    if (stringed_curr == stringify([snake_body[snake_length - 1].x, snake_body[snake_length - 1].y]))
      return true
  }
  return false
}

const DEPTH_PARAMETER_DIVISOR = 15
const HEALTH_THRESHOLD = 20
const TIME_TO_DIET = 100

function transform_battle_score(enemy_length, my_length, score) {
  if (enemy_length >= my_length) return score - 10
  return score + 1
}

function transform_food_score(req, score, curr_depth = 0) {
  if (req.body.turn < TIME_TO_DIET || req.body.you.health < HEALTH_THRESHOLD)
    return score + 5 + curr_depth
  return score + 1
}

function transform_tail_chase_score(score, curr_depth) {
  return score + curr_depth
}

function local_space_score(req, obstacles_coord, foods_coord, move) {
  var score = 0

  var x_head = req.body.you.body[0].x
  var y_head = req.body.you.body[0].y
  var move_pos = get_move_pos(x_head, y_head, move)
  var futures = [get_north(move_pos), get_west(move_pos), get_south(move_pos), get_east(move_pos)]

  var my_length = req.body.you.body.length
  var enemy_length

  for (let future of futures) {
    if (stringify(future) in obstacles_coord) {
      score -= 1 // Decrement score by 1 for every immediate obstacle
      enemy_length = obstacles_coord[stringify(future)]
      if (typeof enemy_length == "number") { // type number means it's a snake head
        score = transform_battle_score(enemy_length, my_length, score)
      }
    } else if (stringify(future) in foods_coord) {
      score = transform_food_score(req, score)
    }
  }

  return score
}

function limited_BFS(req, queue, marked, obstacles_coord, foods_coord, score) {
  var curr = queue.shift()
  var curr_coord = curr[0]
  var curr_depth = curr[1]

  score.s += 1 // Increment score by 1 for every non-obstacle space explored
  if (stringify(curr_coord) in foods_coord) score.s = transform_food_score(req, score.s, curr_depth)
  if (is_current_tail(req, curr_coord)) score.s = transform_tail_chase_score(score.s, curr_depth)

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

function global_space_score(req, obstacles_coord, foods_coord, move) {
  var x_head = req.body.you.body[0].x
  var y_head = req.body.you.body[0].y
  var move_pos = get_move_pos(x_head, y_head, move)

  var depth = Math.ceil(req.body.turn / DEPTH_PARAMETER_DIVISOR)
  var queue = [[move_pos, depth]] // List of (coord, depth) pairs

  var marked = {}
  marked[stringify(move_pos)] = "marked"

  var score = { "s": 0 }
  limited_BFS(req, queue, marked, obstacles_coord, foods_coord, score)
  return score.s
}

function get_best_move(req, obstacles_coord, foods_coord) {
  var moves = shuffle_array(["up", "left", "down", "right"])
  moves = moves.map(move => [move, 0])
  moves = moves.filter(move => is_legal_move(req, obstacles_coord, move[0]))
  if (moves.length == 0) {
    console.log("====== No legal moves available ======")
    return "up"
  }
  
  moves = moves.map(move => [move[0], move[1] + local_space_score(req, obstacles_coord, foods_coord, move[0])])
  moves = moves.map(move => [move[0], move[1] + global_space_score(req, obstacles_coord, foods_coord, move[0])])

  moves.sort((a, b) => b[1] - a[1])
  console.log("Turn: " + req.body.turn + ". Move rankings ======> " + moves)
  return moves[0][0] // Move with the highest score
}

app.post('/move', (req, res) => {
  const data = {
    move: "up", // coordinate (0,0) is at the upper left corner
  }

  var obstacles_coord = get_obstacles_coord(req)
  var foods_coord = get_foods_coord(req)
  data.move = get_best_move(req, obstacles_coord, foods_coord)

  return res.json(data)
})

app.post('/end', (request, response) => {
  return response.json({})
})

app.post('/ping', (request, response) => {
  return response.json({});
})

// --- SNAKE LOGIC GOES ABOVE THIS LINE ---

app.use('*', fallbackHandler)
app.use(notFoundHandler)
app.use(genericErrorHandler)

app.listen(app.get('port'), () => {
  console.log('Server listening on port %s', app.get('port'))
})
