#!/usr/bin/env bash

docker run \
    -d \
    --rm \
    --name="weather-microservice" \
    weather-microservice
