FROM ghcr.io/5etools-mirror-3/5etools-img:latest

COPY . /var/www/localhost/htdocs/

# Deploy-time default books (docs/DEFAULT_BOOKS.md), in two halves. The build wires the pages and
# leaves a writable config file; the entrypoint fills that file in from the environment. Splitting
# it this way is what lets the container run as a non-root user: start-up overwrites one existing
# file rather than creating anything.
RUN mv /var/www/localhost/htdocs/docker/entrypoint.sh /docker-entrypoint.sh \
	&& chmod +x /docker-entrypoint.sh \
	&& sh /var/www/localhost/htdocs/docker/inject-defaults.sh /var/www/localhost/htdocs \
	&& rm -rf /var/www/localhost/htdocs/docker

ENTRYPOINT ["/docker-entrypoint.sh"]
# Restating the base image's own command, because setting ENTRYPOINT discards the inherited CMD
CMD ["lighttpd", "-D", "-f", "/etc/lighttpd/lighttpd.conf"]
