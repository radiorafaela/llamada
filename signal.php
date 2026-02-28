<?php
// signal.php
header('Content-Type: application/json');
header('Cache-Control: no-cache, must-revalidate');
// Si vas a usar dominios distintos, habilita CORS: header('Access-Control-Allow-Origin: *');

$action = $_GET['action'] ?? '';
$sender = $_GET['sender'] ?? ''; // 'a' o 'b'

$dir = __DIR__ . '/data';

// Crea la carpeta de datos temporal si no existe
if (!is_dir($dir)) {
    mkdir($dir, 0777, true);
} // Importante: en algunos hostings tendrás que crear la carpeta "data" manualmente y darle permisos 777

$receiver = ($sender === 'a') ? 'b' : 'a';
$fileSender = $dir . '/' . $sender . '_out.json';
$fileReceiver = $dir . '/' . $receiver . '_out.json';

if ($action === 'send') {
    $data = file_get_contents("php://input");
    $messages = [];
    
    if (file_exists($fileSender)) {
        $content = file_get_contents($fileSender);
        if ($content) $messages = json_decode($content, true);
        if (!is_array($messages)) $messages = [];
    }
    
    $messages[] = json_decode($data);
    
    // Evitamos que el JSON crezca infinitamente (max 15 mensajes en cola)
    if (count($messages) > 15) {
        $messages = array_slice($messages, -15);
    }
    
    file_put_contents($fileSender, json_encode($messages));
    echo json_encode(['status' => 'ok']);

} elseif ($action === 'receive') {
    // El usuario "sender" lee lo que le ha dejado en el buzón el "receiver"
    if (file_exists($fileReceiver)) {
        $content = file_get_contents($fileReceiver);
        echo $content ? $content : '[]';
        // Vaciamos el buzón tras leerlo para ahorrar recursos y evitar procesar duplicados
        file_put_contents($fileReceiver, '[]'); 
    } else {
        echo '[]';
    }
} else {
    echo json_encode(['error' => 'invalid action']);
}
