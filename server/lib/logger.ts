import { createLogger, format, transports } from 'winston';

// Define the format for timestamps
const timestampFormat = () => {
    return new Date().toISOString();
};

// Create a structured logger using Winston
const logger = createLogger({
    level: 'info',
    format: format.combine(
        format.timestamp({ format: timestampFormat }),
        format.json()
    ),
    transports: [
        new transports.Console(),
        new transports.File({ filename: 'error.log', level: 'error' }),
        new transports.File({ filename: 'combined.log' })
    ],
});

export default logger;