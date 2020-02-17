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

const WIDER_SEARCH_LIMIT = 2
const HEALTH_THRESHOLD = 15

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

function stringify(coord) {
  return coord[0].toString() + "," + coord[1].toString()
}

function get_obstacles_coord(req) {
  var coord = {}

  var snakes = req.body.board.snakes
  for (let snake of snakes) {
    var snake_body = snake.body
    coord[stringify([snake_body[0].x, snake_body[0].y])] = snake_body.length
    for (var i = 1; i < snake_body.length - 2; i++) {
      coord[stringify([snake_body[i].x, snake_body[i].y])] = "body"
    }
    // If a snake ate, its body size in the next turn will be incremented by one (that's why it is handled)
    coord[stringify([snake_body[snake_body.length - 2].x, snake_body[snake_body.length - 2].y])] = "tail"
  }

  var x_max = req.body.board.width
  var y_max = req.body.board.height
  for (var i = 0; i < x_max; i++) {
    coord[stringify([i, -1])] = "wall" // Top wall
    coord[stringify([i, -2])] = "wall" // Top wall layer 2
    coord[stringify([i, y_max])] = "wall" // Bottom wall
    coord[stringify([i, y_max + 1])] = "wall" // Bottom wall layer 2
  }
  for (var i = 0; i < y_max; i++) {
    coord[stringify([-1, i])] = "wall" // Left wall
    coord[stringify([-2, i])] = "wall" // Left wall layer 2
    coord[stringify([x_max, i])] = "wall" // Right wall
    coord[stringify([x_max + 1, i])] = "wall" // Right wall layer 2
  }

  return coord
}

function is_legal_move(req, obstacles_coord, move) {
  // Make sure it doesn't eat itself and collide with obstacles
  var x_head = req.body.you.body[0].x
  var y_head = req.body.you.body[0].y

  var future_pos
  if (move == "up") future_pos = [x_head, y_head - 1]
  else if (move == "left") future_pos = [x_head - 1, y_head]
  else if (move == "down") future_pos = [x_head, y_head + 1]
  else future_pos = [x_head + 1, y_head]

  return !(stringify(future_pos) in obstacles_coord)
}

function transform_score(enemy_length, my_length, score) {
  if (typeof enemy_length == "number") { // It's a snake head
    if (enemy_length >= my_length) score -= 4
    else if (enemy_length < my_length) score += 1

  } else {
    score -= 3
  }
  return score
}

function local_space_score(req, obstacles_coord, move) {
  // Assign score to moves based on the # of available spots locally
  var score = 12
  var x_head = req.body.you.body[0].x
  var y_head = req.body.you.body[0].y

  var future_pos
  if (move == "up") future_pos = [x_head, y_head - 1]
  else if (move == "left") future_pos = [x_head - 1, y_head]
  else if (move == "down") future_pos = [x_head, y_head + 1]
  else future_pos = [x_head + 1, y_head]

  var north_of_future = [future_pos[0], future_pos[1] - 1]
  var west_of_future = [future_pos[0] - 1, future_pos[1]]
  var south_of_future = [future_pos[0], future_pos[1] + 1]
  var east_of_future =[future_pos[0] + 1, future_pos[1]]


  var my_length = req.body.you.body.length
  var enemy_length
  if (stringify(north_of_future) in obstacles_coord) {
    enemy_length = obstacles_coord[stringify(north_of_future)]
    score = transform_score(enemy_length, my_length, score)
  }
  if (stringify(west_of_future) in obstacles_coord) {
    enemy_length = obstacles_coord[stringify(west_of_future)]
    score = transform_score(enemy_length, my_length, score)
  }
  if (stringify(south_of_future) in obstacles_coord) {
    enemy_length = obstacles_coord[stringify(south_of_future)]
    score = transform_score(enemy_length, my_length, score)
  }
  if (stringify(east_of_future) in obstacles_coord) {
    enemy_length = obstacles_coord[stringify(east_of_future)]
    score = transform_score(enemy_length, my_length, score)
  }


  var food_spot = {}
  var health = req.body.you.health
  if (health > HEALTH_THRESHOLD) {
    var foods = req.body.board.food
    for (let food of foods) food_spot[stringify([food.x, food.y])] = "food"
  }

  // food_spot is mutually exclusive with obstacles_coord
  if (stringify(north_of_future) in food_spot) score -= 1
  if (stringify(west_of_future) in food_spot) score -= 1
  if (stringify(south_of_future) in food_spot) score -= 1
  if (stringify(east_of_future) in food_spot) score -= 1

  return score
}

function wider_space_score(req, obstacles_coord, move) {
  // Assign score to moves based on the # of available spots within a rectangular area
  var x_head = req.body.you.body[0].x
  var y_head = req.body.you.body[0].y

  // Find the rectangular area ahead of the snake's orientation
  var future_pos, x_lower_range, x_upper_range, y_lower_range, y_upper_range
  if (move == "up") {
    future_pos = [x_head, y_head - 1]
    x_lower_range = future_pos[0] - WIDER_SEARCH_LIMIT
    x_upper_range = future_pos[0] + WIDER_SEARCH_LIMIT
    y_lower_range = future_pos[1] - WIDER_SEARCH_LIMIT
    y_upper_range = future_pos[1]
  }
  else if (move == "left") {
    future_pos = [x_head - 1, y_head]
    x_lower_range = future_pos[0] - WIDER_SEARCH_LIMIT
    x_upper_range = future_pos[0]
    y_lower_range = future_pos[1] - WIDER_SEARCH_LIMIT
    y_upper_range = future_pos[1] + WIDER_SEARCH_LIMIT
  }
  else if (move == "down") {
    future_pos = [x_head, y_head + 1]
    x_lower_range = future_pos[0] - WIDER_SEARCH_LIMIT
    x_upper_range = future_pos[0] + WIDER_SEARCH_LIMIT
    y_lower_range = future_pos[1]
    y_upper_range = future_pos[1] + WIDER_SEARCH_LIMIT
  }
  else {
    future_pos = [x_head + 1, y_head]
    x_lower_range = future_pos[0]
    x_upper_range = future_pos[0] + WIDER_SEARCH_LIMIT
    y_lower_range = future_pos[1] - WIDER_SEARCH_LIMIT
    y_upper_range = future_pos[1] + WIDER_SEARCH_LIMIT
  }

  var score = (x_upper_range - x_lower_range + 1) * (y_upper_range - y_lower_range + 1)
  for (var i = x_lower_range; i <= x_upper_range; i++)
    for (var j = y_lower_range; j <= y_upper_range; j++)
      if (stringify([i, j]) in obstacles_coord)
        score -= 1

  return score
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
  
  move_rankings = move_rankings.map(move => [move[0], move[1] + wider_space_score(req, obstacles_coord, move[0])])

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
