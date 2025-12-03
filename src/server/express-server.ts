import express from "express";
import type { Application, Request, Response, NextFunction } from "express"; // Added NextFunction
import cors from "cors";
import routes from "@/routes/index.js";
import { logger } from "@/utils/index.js"; // Import your logger

export class ExpressServer {
	private app: Application;

	constructor() {
		this.app = express();
		this.setupMiddleware();
		this.setupRoutes();
		this.setupErrorHandling(); // Added error handling setup
	}

	private setupMiddleware() {
		this.app.use(cors());
		this.app.use(express.json());

		// --- Request Logging Middleware ---
		this.app.use((req: Request, res: Response, next: NextFunction) => {
			// Log basic request info
			logger.info({ method: req.method, url: req.originalUrl }, "Incoming request");


			logger.info({ body: req.body }, "Request body");

			// Capture response finish event to log status code
			res.on('finish', () => {
				logger.info({ statusCode: res.statusCode, method: req.method, url: req.originalUrl }, "Request finished");
			});

			next(); // Pass control to the next middleware
		});
		// --- End Request Logging Middleware ---

		console.log("Express server initialized with middleware");
	}

	private setupRoutes() {
		this.app.use("/", routes);

		this.app.all("*", (_: Request, res: Response) =>
			res.status(404).json({ error: "URL not found" }),
		);
	}

	// --- Error Handling Middleware ---
	private setupErrorHandling() {
		this.app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
			// Log the error details
			logger.error(
				{
					err: {
						message: err.message,
						stack: err.stack, // Include stack trace for detailed debugging
					},
					method: req.method,
					url: req.originalUrl,
					body: req.body, // Log body on error for context
				},
				"An error occurred during request processing",
			);

			// Respond with a generic error message (avoid leaking details in production)
			if (!res.headersSent) {
				res.status(500).json({ error: "Internal Server Error" });
			} else {
				// If headers were already sent, delegate to default Express error handler
				next(err);
			}
		});
	}
	// --- End Error Handling Middleware ---

	public getApp(): Application {
		return this.app;
	}
}