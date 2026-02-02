using System;
using System.Threading;

namespace OverlayBridge
{
    class Program
    {
        private static WebSocketServer _server;
        private static OverlayManager _overlayManager;
        private static bool _running = true;

        static void Main(string[] args)
        {
            Console.WriteLine("ETS2 Local Radio - Overlay Bridge");
            Console.WriteLine("==================================");

            int port = 8332;
            if (args.Length > 0 && int.TryParse(args[0], out int customPort))
            {
                port = customPort;
            }

            _overlayManager = new OverlayManager();
            _server = new WebSocketServer(port, _overlayManager);

            // Handle Ctrl+C
            Console.CancelKeyPress += (sender, e) =>
            {
                e.Cancel = true;
                _running = false;
            };

            try
            {
                _server.Start();
                Console.WriteLine($"WebSocket server started on ws://localhost:{port}");
                Console.WriteLine("Press Ctrl+C to stop...");

                while (_running)
                {
                    Thread.Sleep(100);
                }
            }
            catch (Exception ex)
            {
                Console.WriteLine($"Error: {ex.Message}");
            }
            finally
            {
                _server?.Stop();
                _overlayManager?.Detach();
                Console.WriteLine("Overlay Bridge stopped.");
            }
        }
    }
}
