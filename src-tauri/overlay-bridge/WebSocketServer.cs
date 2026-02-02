using System;
using System.Collections.Generic;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace OverlayBridge
{
    public class WebSocketServer
    {
        private readonly int _port;
        private readonly OverlayManager _overlayManager;
        private TcpListener _listener;
        private Thread _listenerThread;
        private bool _running;
        private readonly List<TcpClient> _clients = new List<TcpClient>();

        public WebSocketServer(int port, OverlayManager overlayManager)
        {
            _port = port;
            _overlayManager = overlayManager;
        }

        public void Start()
        {
            _listener = new TcpListener(IPAddress.Loopback, _port);
            _listener.Start();
            _running = true;

            _listenerThread = new Thread(ListenForClients);
            _listenerThread.IsBackground = true;
            _listenerThread.Start();
        }

        public void Stop()
        {
            _running = false;
            _listener?.Stop();

            lock (_clients)
            {
                foreach (var client in _clients)
                {
                    try { client.Close(); } catch { }
                }
                _clients.Clear();
            }
        }

        private void ListenForClients()
        {
            while (_running)
            {
                try
                {
                    TcpClient client = _listener.AcceptTcpClient();
                    lock (_clients) { _clients.Add(client); }

                    Thread clientThread = new Thread(() => HandleClient(client));
                    clientThread.IsBackground = true;
                    clientThread.Start();
                }
                catch (SocketException)
                {
                    // Listener stopped
                    break;
                }
            }
        }

        private void HandleClient(TcpClient client)
        {
            NetworkStream stream = client.GetStream();

            try
            {
                // WebSocket handshake
                if (!PerformHandshake(stream))
                {
                    client.Close();
                    return;
                }

                Console.WriteLine("Client connected");

                // Send initial status
                SendMessage(stream, JsonConvert.SerializeObject(new
                {
                    type = "status",
                    attached = _overlayManager.IsAttached,
                    game = _overlayManager.CurrentGame
                }));

                // Read messages
                while (_running && client.Connected)
                {
                    string message = ReadMessage(stream);
                    if (message == null) break;

                    ProcessMessage(message, stream);
                }
            }
            catch (Exception ex)
            {
                Console.WriteLine($"Client error: {ex.Message}");
            }
            finally
            {
                lock (_clients) { _clients.Remove(client); }
                client.Close();
                Console.WriteLine("Client disconnected");
            }
        }

        private bool PerformHandshake(NetworkStream stream)
        {
            byte[] buffer = new byte[4096];
            int bytesRead = stream.Read(buffer, 0, buffer.Length);
            string request = Encoding.UTF8.GetString(buffer, 0, bytesRead);

            if (!request.Contains("Upgrade: websocket"))
                return false;

            // Extract Sec-WebSocket-Key
            Match match = Regex.Match(request, @"Sec-WebSocket-Key: (.+)\r\n");
            if (!match.Success) return false;

            string key = match.Groups[1].Value.Trim();
            string acceptKey = Convert.ToBase64String(
                SHA1.Create().ComputeHash(
                    Encoding.UTF8.GetBytes(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")
                )
            );

            string response =
                "HTTP/1.1 101 Switching Protocols\r\n" +
                "Upgrade: websocket\r\n" +
                "Connection: Upgrade\r\n" +
                $"Sec-WebSocket-Accept: {acceptKey}\r\n\r\n";

            byte[] responseBytes = Encoding.UTF8.GetBytes(response);
            stream.Write(responseBytes, 0, responseBytes.Length);

            return true;
        }

        private string ReadMessage(NetworkStream stream)
        {
            try
            {
                byte[] header = new byte[2];
                if (stream.Read(header, 0, 2) < 2) return null;

                bool fin = (header[0] & 0x80) != 0;
                int opcode = header[0] & 0x0F;
                bool masked = (header[1] & 0x80) != 0;
                long length = header[1] & 0x7F;

                // Handle close frame
                if (opcode == 8) return null;

                // Handle ping
                if (opcode == 9)
                {
                    // Send pong
                    byte[] pong = new byte[] { 0x8A, 0x00 };
                    stream.Write(pong, 0, pong.Length);
                    return ReadMessage(stream);
                }

                if (length == 126)
                {
                    byte[] extLen = new byte[2];
                    stream.Read(extLen, 0, 2);
                    length = (extLen[0] << 8) | extLen[1];
                }
                else if (length == 127)
                {
                    byte[] extLen = new byte[8];
                    stream.Read(extLen, 0, 8);
                    length = BitConverter.ToInt64(extLen, 0);
                }

                byte[] mask = new byte[4];
                if (masked)
                {
                    stream.Read(mask, 0, 4);
                }

                byte[] payload = new byte[length];
                int totalRead = 0;
                while (totalRead < length)
                {
                    int read = stream.Read(payload, totalRead, (int)(length - totalRead));
                    if (read == 0) return null;
                    totalRead += read;
                }

                if (masked)
                {
                    for (int i = 0; i < payload.Length; i++)
                    {
                        payload[i] ^= mask[i % 4];
                    }
                }

                return Encoding.UTF8.GetString(payload);
            }
            catch
            {
                return null;
            }
        }

        private void SendMessage(NetworkStream stream, string message)
        {
            byte[] payload = Encoding.UTF8.GetBytes(message);
            byte[] frame;

            if (payload.Length < 126)
            {
                frame = new byte[2 + payload.Length];
                frame[0] = 0x81; // Text frame, FIN
                frame[1] = (byte)payload.Length;
                Array.Copy(payload, 0, frame, 2, payload.Length);
            }
            else if (payload.Length < 65536)
            {
                frame = new byte[4 + payload.Length];
                frame[0] = 0x81;
                frame[1] = 126;
                frame[2] = (byte)(payload.Length >> 8);
                frame[3] = (byte)(payload.Length & 0xFF);
                Array.Copy(payload, 0, frame, 4, payload.Length);
            }
            else
            {
                frame = new byte[10 + payload.Length];
                frame[0] = 0x81;
                frame[1] = 127;
                long len = payload.Length;
                for (int i = 0; i < 8; i++)
                {
                    frame[9 - i] = (byte)(len & 0xFF);
                    len >>= 8;
                }
                Array.Copy(payload, 0, frame, 10, payload.Length);
            }

            stream.Write(frame, 0, frame.Length);
        }

        private void ProcessMessage(string message, NetworkStream stream)
        {
            try
            {
                JObject json = JObject.Parse(message);
                string command = json["command"]?.ToString();

                Console.WriteLine($"Received command: {command}");

                switch (command)
                {
                    case "attach":
                        string game = json["game"]?.ToString() ?? "ets2";
                        bool success = _overlayManager.Attach(game);
                        SendMessage(stream, JsonConvert.SerializeObject(new
                        {
                            type = "attach_result",
                            success = success,
                            game = game
                        }));
                        break;

                    case "detach":
                        _overlayManager.Detach();
                        SendMessage(stream, JsonConvert.SerializeObject(new
                        {
                            type = "detach_result",
                            success = true
                        }));
                        break;

                    case "show":
                        string stationName = json["station"]?.ToString() ?? "";
                        string signal = json["signal"]?.ToString() ?? "5";
                        string logo = json["logo"]?.ToString();
                        string nowPlaying = json["nowPlaying"]?.ToString() ?? "Now playing:";
                        bool rtl = json["rtl"]?.Value<bool>() ?? false;

                        _overlayManager.ShowStation(stationName, signal, logo, nowPlaying, rtl);
                        SendMessage(stream, JsonConvert.SerializeObject(new
                        {
                            type = "show_result",
                            success = true
                        }));
                        break;

                    case "hide":
                        _overlayManager.HideOverlay();
                        SendMessage(stream, JsonConvert.SerializeObject(new
                        {
                            type = "hide_result",
                            success = true
                        }));
                        break;

                    case "status":
                        SendMessage(stream, JsonConvert.SerializeObject(new
                        {
                            type = "status",
                            attached = _overlayManager.IsAttached,
                            game = _overlayManager.CurrentGame
                        }));
                        break;

                    default:
                        SendMessage(stream, JsonConvert.SerializeObject(new
                        {
                            type = "error",
                            message = $"Unknown command: {command}"
                        }));
                        break;
                }
            }
            catch (Exception ex)
            {
                SendMessage(stream, JsonConvert.SerializeObject(new
                {
                    type = "error",
                    message = ex.Message
                }));
            }
        }
    }
}
